import express, { Request, Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";
import { rateLimitMiddleware, rateLimitPublic, getClientIp } from "../middleware/rateLimiter";
import {
  getDbUser,
  getDbUserById,
  getAcceptedFriendIdSet,
  createNotification,
  syncUserCalendar,
  generateCallWindowSlots,
  mergeCallWindowSlots,
  applyTravelBuffer,
  getAuthedCalendarClient,
  getOutlookGraphClient,
  fetchAppleBusyBlocks,
  autoAddToCalendar,
  formatDateTimeForTimeZone,
} from "../utils/helpers";
import { sendEventPollNudgeEmail, sendPollSettledEmail } from "../utils/email";
import { getSupabase } from "../supabase";
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import { google } from "googleapis";

const router = express.Router();

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatNameList(names: string[]) {
  if (names.length <= 1) return names[0] || "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function truncatePreviewText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function authWithRateLimit(req: AuthRequest, res: Response, next: express.NextFunction): void {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    rateLimitMiddleware(req, res, next);
  });
}

// ---------------------------------------------------------------------------
// Events — search SeatGeek & Ticketmaster, match with friend availability
// ---------------------------------------------------------------------------

const SEATGEEK_CLIENT_ID = process.env.SEATGEEK_CLIENT_ID || "";
const TICKETMASTER_API_KEY = process.env.TICKETMASTER_API_KEY || "";
const EVENTBRITE_API_KEY = process.env.EVENTBRITE_API_KEY || "";
const MEETUP_API_KEY = process.env.MEETUP_API_KEY || "";
const NYC_OPEN_DATA_APP_TOKEN = process.env.NYC_OPEN_DATA_APP_TOKEN || "";

// Log which APIs are configured at cold-start
console.log(`Event APIs configured — SeatGeek: ${!!SEATGEEK_CLIENT_ID}, Ticketmaster: ${!!TICKETMASTER_API_KEY}, Eventbrite: ${!!EVENTBRITE_API_KEY}`);
// v2.17.1 — duration-aware scoring

interface ExternalEvent {
  id: string;
  source: "seatgeek" | "ticketmaster" | "eventbrite" | "meetup" | "nyc_open_data";
  sources?: string[];          // all sources this event was found on
  title: string;
  type: string;
  venue: string;
  city: string;
  datetime: string;
  datetimeLocal: string;
  url: string;
  urls?: { source: string; url: string }[];  // ticket links from all sources
  imageUrl?: string;
  priceMin?: number;
  priceMax?: number;
  performers?: string[];
}

/**
 * Normalize a title for fuzzy matching:
 * - lowercase, strip "the", punctuation, extra whitespace
 * - collapse common suffixes like "- new york" or "(broadway)"
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s*[-\u2013\u2014]\s*(new york|nyc|broadway|chicago|los angeles|la|london)$/i, "")
    .replace(/\(.*?\)/g, "")           // strip parenthetical info
    .replace(/\b(the|a|an|at|in|on|of)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")       // remove punctuation
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize venue name for comparison.
 * Handles "The Hayes Theater" vs "Helen Hayes Theatre", "St. James Theatre" vs "St James Theater", etc.
 */
function normalizeVenue(venue: string): string {
  return venue
    .toLowerCase()
    .replace(/\b(the|a)\b/g, "")
    .replace(/theatre/g, "theater")
    .replace(/ctr\b/g, "center")
    .replace(/st\./g, "st")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

/**
 * Check if two normalized titles are "the same event".
 * Uses exact match after normalization, OR checks if one contains the other
 * (handles "Hamilton" vs "Hamilton: An American Musical").
 */
function titlesMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length >= 8 && b.includes(a)) return true;
  if (b.length >= 8 && a.includes(b)) return true;
  if (a.length > 10 && b.length > 10) {
    const shorter = a.length < b.length ? a : b;
    const longer = a.length < b.length ? b : a;
    if (longer.includes(shorter.slice(0, Math.floor(shorter.length * 0.8)))) return true;
  }
  return false;
}

/**
 * Check if two venues are likely the same physical location.
 */
function venuesMatch(a: string, b: string): boolean {
  const normA = normalizeVenue(a);
  const normB = normalizeVenue(b);
  if (!normA || !normB) return true; // missing venue = don't penalize
  if (normA === normB) return true;
  if (normA.length >= 8 && normB.includes(normA)) return true;
  if (normB.length >= 8 && normA.includes(normB)) return true;
  return false;
}

/**
 * Parse a datetime string to epoch ms, handling missing trailing Z.
 * SeatGeek omits trailing Z on UTC times; Ticketmaster includes it.
 */
function parseEventTime(dt: string): number {
  if (!dt) return 0;
  const normalized = dt.endsWith("Z") ? dt : dt + "Z";
  return new Date(normalized).getTime();
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedAsUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return zonedAsUtc - date.getTime();
}

function parseShowtimeAsEventLocalTime(datetime: string, timeZone = "America/New_York"): Date {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(datetime)) {
    return new Date(datetime);
  }

  const match = datetime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return new Date(datetime);

  const [, year, month, day, hour, minute, second = "0"] = match;
  const localAsUtc = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  ));
  const firstOffset = getTimeZoneOffsetMs(localAsUtc, timeZone);
  const firstCandidate = new Date(localAsUtc.getTime() - firstOffset);
  const finalOffset = getTimeZoneOffsetMs(firstCandidate, timeZone);
  return new Date(localAsUtc.getTime() - finalOffset);
}

function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

/**
 * Deduplicate events from multiple sources.
 * Matches the SAME performance (same title + same datetime within 2hr) across platforms.
 * Each distinct showtime remains a separate entry — recurring shows are NOT collapsed.
 * When the same performance appears on multiple platforms, merges ticket links.
 */
function deduplicateEvents(events: ExternalEvent[]): ExternalEvent[] {
  const TIME_TOLERANCE_MS = 2 * 3600000; // 2 hours
  const groups: ExternalEvent[][] = [];

  for (const ev of events) {
    const normTitle = normalizeTitle(ev.title);
    const evTime = parseEventTime(ev.datetime);

    let matched = false;
    for (const group of groups) {
      const rep = group[0];
      const repNorm = normalizeTitle(rep.title);
      const repTime = parseEventTime(rep.datetime);

      if (!titlesMatch(normTitle, repNorm)) continue;

      const timeDiff = Math.abs(evTime - repTime);
      if (timeDiff > TIME_TOLERANCE_MS) continue;

      group.push(ev);
      matched = true;
      break;
    }

    if (!matched) {
      groups.push([ev]);
    }
  }

  return groups.map((group) => {
    const sorted = [...group].sort((a, b) => {
      if (a.source === "ticketmaster" && b.source !== "ticketmaster") return -1;
      if (a.source !== "ticketmaster" && b.source === "ticketmaster") return 1;
      if (a.source === "seatgeek" && b.source !== "seatgeek") return -1;
      if (a.source !== "seatgeek" && b.source === "seatgeek") return 1;
      if (a.imageUrl && !b.imageUrl) return -1;
      if (!a.imageUrl && b.imageUrl) return 1;
      if ((a.priceMin || Infinity) !== (b.priceMin || Infinity)) {
        return (a.priceMin || Infinity) - (b.priceMin || Infinity);
      }
      return 0;
    });

    const primary = sorted[0];

    const seenSources = new Set<string>();
    const urls: { source: string; url: string }[] = [];
    const sortedGroup = [...group].sort((a, b) => {
      if (a.source === "ticketmaster") return -1;
      if (b.source === "ticketmaster") return 1;
      return 0;
    });
    for (const ev of sortedGroup) {
      if (!seenSources.has(ev.source)) {
        seenSources.add(ev.source);
        urls.push({ source: ev.source, url: ev.url });
      }
    }
    const sources = [...seenSources];

    const allMins = group.map((e) => e.priceMin).filter((p): p is number => p !== undefined && p > 0);
    const allMaxes = group.map((e) => e.priceMax).filter((p): p is number => p !== undefined && p > 0);
    const allPerformers = [...new Set(group.flatMap((e) => e.performers || []))];
    const bestImage = group.find((e) => e.imageUrl && e.source === "seatgeek")?.imageUrl
      || group.find((e) => e.imageUrl)?.imageUrl;

    return {
      ...primary,
      sources,
      urls,
      imageUrl: bestImage || primary.imageUrl,
      priceMin: allMins.length > 0 ? Math.min(...allMins) : undefined,
      priceMax: allMaxes.length > 0 ? Math.max(...allMaxes) : undefined,
      performers: allPerformers.length > 0 ? allPerformers : primary.performers,
    };
  });
}

/**
 * Waterfall search: Ticketmaster first, SeatGeek only if TM returns 0 results.
 * Eliminates cross-platform duplication by only ever querying one ticketing platform per search.
 */
async function searchTicketedEvents(params: {
  q: string; city?: string; type?: string; dateFrom?: string; dateTo?: string; perPage?: number;
}): Promise<ExternalEvent[]> {
  const tmResults = await searchTicketmaster(params);
  if (tmResults.length > 0) return tmResults;
  return searchSeatGeek(params);
}

/** Search SeatGeek for events */
async function searchSeatGeek(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  if (!SEATGEEK_CLIENT_ID) return [];
  try {
    const url = new URL("https://api.seatgeek.com/2/events");
    url.searchParams.set("client_id", SEATGEEK_CLIENT_ID);
    url.searchParams.set("q", params.q);
    url.searchParams.set("per_page", String(params.perPage || 25));
    url.searchParams.set("sort", params.dateFrom || params.dateTo ? "datetime_utc.asc" : "score.desc");

    if (params.city) {
      // SeatGeek uses venue.city for location filtering
      url.searchParams.set("venue.city", params.city);
    }
    if (params.type) {
      // Map our types to SeatGeek taxonomy
      const typeMap: Record<string, string> = {
        theater: "theater",
        concert: "concert",
        sports: "sports",
        comedy: "comedy",
        festivals: "festival",
        dance: "dance_performance_tour",
        opera: "theater",
        family: "family",
      };
      const sgType = typeMap[params.type];
      if (sgType) url.searchParams.set("type", sgType);
    }
    if (params.dateFrom) {
      url.searchParams.set("datetime_utc.gte", new Date(params.dateFrom).toISOString());
    }
    if (params.dateTo) {
      url.searchParams.set("datetime_utc.lte", new Date(params.dateTo + "T23:59:59").toISOString());
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("SeatGeek API error:", resp.status, await resp.text());
      return [];
    }
    const data = await resp.json();
    return (data.events || []).map((ev: any) => ({
      id: `sg-${ev.id}`,
      source: "seatgeek" as const,
      title: ev.title || ev.short_title || "",
      type: ev.type || ev.taxonomies?.[0]?.name || "event",
      venue: ev.venue?.name || "",
      city: ev.venue?.city || "",
      datetime: ev.datetime_utc || "",
      datetimeLocal: ev.datetime_local || ev.datetime_utc || "",
      url: ev.url || "",
      imageUrl: ev.performers?.[0]?.image || ev.performers?.[0]?.images?.huge || "",
      priceMin: ev.stats?.lowest_sg_base_price || ev.stats?.lowest_price || undefined,
      priceMax: ev.stats?.highest_price || undefined,
      performers: (ev.performers || []).map((p: any) => p.name).filter(Boolean),
    }));
  } catch (err) {
    console.error("SeatGeek search error:", err);
    return [];
  }
}

/** Search Ticketmaster for events */
async function searchTicketmaster(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  if (!TICKETMASTER_API_KEY) return [];
  try {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
    url.searchParams.set("apikey", TICKETMASTER_API_KEY);
    url.searchParams.set("keyword", params.q);
    url.searchParams.set("size", String(params.perPage || 25));
    url.searchParams.set("sort", params.dateFrom || params.dateTo ? "date,asc" : "relevance,desc");

    if (params.city) {
      url.searchParams.set("city", params.city);
    }
    if (params.type) {
      // Map our types to Ticketmaster classification
      const classMap: Record<string, string> = {
        theater: "Arts & Theatre",
        concert: "Music",
        sports: "Sports",
        comedy: "Arts & Theatre",
        festivals: "Music",
        dance: "Arts & Theatre",
        opera: "Arts & Theatre",
        family: "Family",
      };
      const cls = classMap[params.type];
      if (cls) url.searchParams.set("classificationName", cls);
    }
    if (params.dateFrom) {
      url.searchParams.set("startDateTime", new Date(params.dateFrom).toISOString().replace(".000Z", "Z"));
    }
    if (params.dateTo) {
      url.searchParams.set("endDateTime", new Date(params.dateTo + "T23:59:59").toISOString().replace(".000Z", "Z"));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("Ticketmaster API error:", resp.status, await resp.text());
      return [];
    }
    const data = await resp.json();
    const events = data._embedded?.events || [];
    return events.map((ev: any) => {
      const venue = ev._embedded?.venues?.[0];
      const prices = ev.priceRanges?.[0];
      const startDate = ev.dates?.start;
      return {
        id: `tm-${ev.id}`,
        source: "ticketmaster" as const,
        title: ev.name || "",
        type: ev.classifications?.[0]?.segment?.name?.toLowerCase() || "event",
        venue: venue?.name || "",
        city: venue?.city?.name || "",
        datetime: startDate?.dateTime || "",
        datetimeLocal: startDate?.localDate
          ? `${startDate.localDate}T${startDate.localTime || "19:00:00"}`
          : startDate?.dateTime || "",
        url: ev.url || "",
        imageUrl: ev.images?.find((img: any) => img.ratio === "16_9" && img.width >= 500)?.url
          || ev.images?.[0]?.url || "",
        priceMin: prices?.min || undefined,
        priceMax: prices?.max || undefined,
        performers: (ev._embedded?.attractions || []).map((a: any) => a.name).filter(Boolean),
      };
    });
  } catch (err) {
    console.error("Ticketmaster search error:", err);
    return [];
  }
}

/** Search Eventbrite for events */
async function searchEventbrite(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  if (!EVENTBRITE_API_KEY) return [];
  try {
    const url = new URL("https://www.eventbriteapi.com/v3/events/search/");
    url.searchParams.set("token", EVENTBRITE_API_KEY);
    url.searchParams.set("q", params.q);
    url.searchParams.set("page_size", String(params.perPage || 25));
    url.searchParams.set("sort_by", "best");
    url.searchParams.set("expand", "venue,ticket_availability");

    if (params.city) {
      url.searchParams.set("location.address", params.city);
      url.searchParams.set("location.within", "30mi");
    }
    if (params.type) {
      const catMap: Record<string, string> = {
        theater: "105",    // Performing & Visual Arts
        concert: "103",    // Music
        sports: "108",     // Sports & Fitness
        comedy: "105",     // Performing & Visual Arts
        festivals: "103",  // Music
        dance: "105",      // Performing & Visual Arts
        opera: "105",      // Performing & Visual Arts
        family: "115",     // Family & Education
        food: "110",       // Food & Drink
        networking: "101", // Business
        community: "113",  // Community & Culture
      };
      const cat = catMap[params.type];
      if (cat) url.searchParams.set("categories", cat);
    }
    if (params.dateFrom) {
      url.searchParams.set("start_date.range_start", new Date(params.dateFrom).toISOString().replace(".000Z", "Z"));
    }
    if (params.dateTo) {
      url.searchParams.set("start_date.range_end", new Date(params.dateTo + "T23:59:59").toISOString().replace(".000Z", "Z"));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("Eventbrite API error:", resp.status, await resp.text());
      return [];
    }
    const data = await resp.json();
    return (data.events || []).map((ev: any) => {
      const venue = ev.venue;
      const isFree = ev.is_free || ev.ticket_availability?.minimum_ticket_price?.major_value === "0";
      return {
        id: `eb-${ev.id}`,
        source: "eventbrite" as const,
        title: ev.name?.text || ev.name?.html || "",
        type: ev.category?.short_name?.toLowerCase() || "event",
        venue: venue?.name || "",
        city: venue?.address?.city || "",
        datetime: ev.start?.utc || "",
        datetimeLocal: ev.start?.local || ev.start?.utc || "",
        url: ev.url || "",
        imageUrl: ev.logo?.url || ev.logo?.original?.url || "",
        priceMin: isFree ? 0 : (ev.ticket_availability?.minimum_ticket_price?.major_value ? parseFloat(ev.ticket_availability.minimum_ticket_price.major_value) : undefined),
        priceMax: ev.ticket_availability?.maximum_ticket_price?.major_value ? parseFloat(ev.ticket_availability.maximum_ticket_price.major_value) : undefined,
        performers: [],
      };
    });
  } catch (err) {
    console.error("Eventbrite search error:", err);
    return [];
  }
}

/** Search Meetup via GraphQL API for events */
async function searchMeetup(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  if (!MEETUP_API_KEY) return [];
  try {
    // Meetup uses a GraphQL API (pro network or open events endpoint)
    const url = new URL("https://api.meetup.com/find/upcoming_events");
    url.searchParams.set("key", MEETUP_API_KEY);
    url.searchParams.set("text", params.q);
    url.searchParams.set("page", String(params.perPage || 25));
    url.searchParams.set("order", "time");

    if (params.city) {
      // Meetup uses lon/lat but also supports text-based location
      url.searchParams.set("lon", "");
      url.searchParams.set("lat", "");
      // Fallback: set the "location" param for text-based city search
      url.searchParams.delete("lon");
      url.searchParams.delete("lat");
      // Use the self_groups endpoint with location or just rely on topic_category + city
      url.searchParams.set("lon", "");
      url.searchParams.delete("lon");
    }

    if (params.type) {
      const topicMap: Record<string, string> = {
        theater: "arts-culture",
        concert: "music",
        sports: "sports-fitness",
        comedy: "arts-culture",
        festivals: "music",
        dance: "dancing",
        food: "food-drink",
        networking: "career-business",
        community: "socializing",
        outdoors: "outdoors-adventure",
        tech: "tech",
      };
      const topic = topicMap[params.type];
      if (topic) url.searchParams.set("topic_category", topic);
    }

    if (params.dateFrom) {
      url.searchParams.set("start_date_range", new Date(params.dateFrom).toISOString());
    }
    if (params.dateTo) {
      url.searchParams.set("end_date_range", new Date(params.dateTo + "T23:59:59").toISOString());
    }

    // Use the open events endpoint as an alternative
    const openUrl = new URL("https://api.meetup.com/find/upcoming_events");
    openUrl.searchParams.set("photo-host", "public");
    openUrl.searchParams.set("page", String(params.perPage || 25));
    openUrl.searchParams.set("text", params.q);
    openUrl.searchParams.set("key", MEETUP_API_KEY);

    const resp = await fetch(openUrl.toString());
    if (!resp.ok) {
      console.error("Meetup API error:", resp.status, await resp.text());
      return [];
    }
    const data = await resp.json();
    const events = data.events || [];
    return events.map((ev: any) => {
      const venue = ev.venue;
      return {
        id: `mu-${ev.id}`,
        source: "meetup" as const,
        title: ev.name || "",
        type: ev.group?.category?.shortname?.toLowerCase() || "meetup",
        venue: venue?.name || ev.group?.name || "",
        city: venue?.city || "",
        datetime: ev.time ? new Date(ev.time).toISOString() : "",
        datetimeLocal: ev.local_date
          ? `${ev.local_date}T${ev.local_time || "19:00:00"}`
          : (ev.time ? new Date(ev.time).toISOString() : ""),
        url: ev.link || ev.event_url || "",
        imageUrl: ev.group?.group_photo?.photo_link || ev.group?.key_photo?.photo_link || "",
        priceMin: ev.fee ? ev.fee.amount : 0,
        priceMax: ev.fee ? ev.fee.amount : undefined,
        performers: ev.group?.name ? [ev.group.name] : [],
      };
    });
  } catch (err) {
    console.error("Meetup search error:", err);
    return [];
  }
}

/** Search NYC Open Data for free city events (parks, libraries, cultural) */
async function searchNYCOpenData(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  // NYC Open Data is free; an app token just raises rate limits
  // Only search if the city is NYC-related or no city filter set
  const nycCities = ["new york", "nyc", "brooklyn", "queens", "bronx", "manhattan", "staten island"];
  if (params.city && !nycCities.some((c) => params.city!.toLowerCase().includes(c))) {
    return []; // Not NYC — skip
  }

  try {
    // NYC Parks Events dataset (Socrata SODA API)
    // Dataset ID: 8x4p-aji6 (NYC Parks Events Listing)
    const url = new URL("https://data.cityofnewyork.us/resource/8x4p-aji6.json");
    if (NYC_OPEN_DATA_APP_TOKEN) {
      url.searchParams.set("$$app_token", NYC_OPEN_DATA_APP_TOKEN);
    }
    url.searchParams.set("$limit", String(params.perPage || 25));
    url.searchParams.set("$order", "startdatetime ASC");

    // Build WHERE clause for filtering
    const where: string[] = [];

    if (params.q) {
      // Full-text search on title and description
      const safeQ = params.q.replace(/'/g, "''");
      where.push(`(upper(title) LIKE '%${safeQ.toUpperCase()}%' OR upper(description) LIKE '%${safeQ.toUpperCase()}%')`);
    }

    const dateFrom = params.dateFrom || new Date().toISOString().split("T")[0];
    where.push(`startdatetime >= '${dateFrom}T00:00:00'`);

    if (params.dateTo) {
      where.push(`startdatetime <= '${params.dateTo}T23:59:59'`);
    }

    if (where.length > 0) {
      url.searchParams.set("$where", where.join(" AND "));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) {
      console.error("NYC Open Data API error:", resp.status, await resp.text());
      // Try alternative dataset: NYC events from libraries, cultural orgs
      return await searchNYCOpenDataAlt(params);
    }

    const data = await resp.json();
    const events: ExternalEvent[] = (data || []).map((ev: any) => ({
      id: `nyc-${ev.uid || ev._id || Math.random().toString(36).slice(2)}`,
      source: "nyc_open_data" as const,
      title: ev.title || ev.name || "",
      type: ev.category?.toLowerCase() || ev.subcategory?.toLowerCase() || "free event",
      venue: ev.location || ev.parknames || "",
      city: ev.borough || "New York",
      datetime: ev.startdatetime || ev.start_date_time || "",
      datetimeLocal: ev.startdatetime || ev.start_date_time || "",
      url: ev.link || ev.url || `https://www.nycgovparks.org/events/${ev.uid || ""}`,
      imageUrl: ev.image || "",
      priceMin: 0, // NYC Open Data events are free
      priceMax: 0,
      performers: [],
    }));
    return events;
  } catch (err) {
    console.error("NYC Open Data search error:", err);
    return [];
  }
}

/** Alternative NYC Open Data dataset — cultural events, library events */
async function searchNYCOpenDataAlt(params: {
  q: string;
  city?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  perPage?: number;
}): Promise<ExternalEvent[]> {
  try {
    // DOHMH Community Events dataset: bkfu-528j
    const url = new URL("https://data.cityofnewyork.us/resource/bkfu-528j.json");
    if (NYC_OPEN_DATA_APP_TOKEN) {
      url.searchParams.set("$$app_token", NYC_OPEN_DATA_APP_TOKEN);
    }
    url.searchParams.set("$limit", String(params.perPage || 25));

    const where: string[] = [];
    if (params.q) {
      const safeQ = params.q.replace(/'/g, "''");
      where.push(`(upper(event_name) LIKE '%${safeQ.toUpperCase()}%')`);
    }
    const dateFrom = params.dateFrom || new Date().toISOString().split("T")[0];
    where.push(`start_date_time >= '${dateFrom}T00:00:00'`);
    if (params.dateTo) {
      where.push(`start_date_time <= '${params.dateTo}T23:59:59'`);
    }
    if (where.length > 0) {
      url.searchParams.set("$where", where.join(" AND "));
    }

    const resp = await fetch(url.toString());
    if (!resp.ok) return [];

    const data = await resp.json();
    return (data || []).map((ev: any) => ({
      id: `nyc-${ev.event_id || Math.random().toString(36).slice(2)}`,
      source: "nyc_open_data" as const,
      title: ev.event_name || ev.name || "",
      type: ev.event_type?.toLowerCase() || "community event",
      venue: ev.event_location || "",
      city: ev.borough || "New York",
      datetime: ev.start_date_time || "",
      datetimeLocal: ev.start_date_time || "",
      url: ev.event_url || "",
      imageUrl: "",
      priceMin: 0,
      priceMax: 0,
      performers: [],
    }));
  } catch (err) {
    console.error("NYC Open Data alt search error:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Event autocomplete — fires as user types
// ---------------------------------------------------------------------------
interface SuggestionItem {
  id: string;
  title: string;
  subtitle?: string;
  type: "event" | "performer" | "venue";
  imageUrl?: string;
  source: "seatgeek" | "ticketmaster";
}

function normalizeEventSearchCity(profile: { event_city?: string | null; neighborhood?: string | null } | null | undefined): string | undefined {
  const source = (profile?.event_city || profile?.neighborhood || "").trim();
  if (!source) return undefined;

  const parts = source.split(",").map((part) => part.trim()).filter(Boolean);
  const candidate = parts.length > 1 ? parts[parts.length - 1] : source;
  const normalized = candidate.toLowerCase();

  if (["nyc", "new york city", "manhattan"].includes(normalized)) return "New York";
  if (["brooklyn", "queens", "bronx", "staten island"].includes(normalized)) return candidate;

  // If the value is "New York, NY", use the city portion rather than the state.
  if (/^[a-z]{2}$/i.test(candidate) && parts.length > 1) return parts[0];

  // Neighborhood-only values like "Upper West Side" are too narrow for event APIs.
  if (!profile?.event_city && parts.length === 1) return undefined;

  return candidate;
}

async function suggestSeatGeek(q: string, city?: string): Promise<SuggestionItem[]> {
  if (!SEATGEEK_CLIENT_ID || !q) return [];
  try {
    const url = new URL("https://api.seatgeek.com/2/events");
    url.searchParams.set("client_id", SEATGEEK_CLIENT_ID);
    url.searchParams.set("q", q);
    url.searchParams.set("per_page", "8");
    if (city) url.searchParams.set("venue.city", city);
    const resp = await fetch(url.toString());
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.events || []).map((ev: any) => ({
      id: `sg-${ev.id}`,
      title: ev.short_title || ev.title || "",
      subtitle: ev.venue?.name
        ? `${ev.venue.name}${ev.venue.city ? ` · ${ev.venue.city}` : ""}`
        : ev.datetime_local
          ? new Date(ev.datetime_local).toLocaleDateString()
          : undefined,
      type: "event" as const,
      imageUrl: ev.performers?.[0]?.image || undefined,
      source: "seatgeek" as const,
    }));
  } catch (err) { console.error(err);
    return [];
  }
}

async function suggestTicketmaster(q: string, city?: string): Promise<SuggestionItem[]> {
  if (!TICKETMASTER_API_KEY || !q) return [];
  try {
    const url = new URL("https://app.ticketmaster.com/discovery/v2/suggest");
    url.searchParams.set("apikey", TICKETMASTER_API_KEY);
    url.searchParams.set("keyword", q);
    if (city) url.searchParams.set("city", city);
    const resp = await fetch(url.toString());
    if (!resp.ok) return [];
    const data = await resp.json();

    const items: SuggestionItem[] = [];

    // Attractions (performers / shows)
    const attractions = data._embedded?.attractions || [];
    for (const a of attractions.slice(0, 4)) {
      items.push({
        id: `tm-attr-${a.id}`,
        title: a.name,
        subtitle: a.classifications?.[0]?.genre?.name || "Event",
        type: "performer",
        imageUrl: a.images?.[0]?.url,
        source: "ticketmaster",
      });
    }

    // Events
    const events = data._embedded?.events || [];
    for (const ev of events.slice(0, 4)) {
      const venue = ev._embedded?.venues?.[0];
      items.push({
        id: `tm-${ev.id}`,
        title: ev.name,
        subtitle: venue?.name
          ? `${venue.name}${venue.city?.name ? ` · ${venue.city.name}` : ""}`
          : undefined,
        type: "event",
        imageUrl: ev.images?.[0]?.url,
        source: "ticketmaster",
      });
    }

    return items;
  } catch (err) { console.error(err);
    return [];
  }
}

/** GET /events/suggest — autocomplete suggestions as user types */
router.get("/events/suggest", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string || "").trim();
    const city = req.query.city as string || undefined;
    if (q.length < 2) {
      res.json({ suggestions: [] });
      return;
    }

    // Waterfall: Ticketmaster first, SeatGeek only if TM returns nothing
    let items = await suggestTicketmaster(q, city);
    if (items.length === 0) {
      items = await suggestSeatGeek(q, city);
    }

    res.json({ suggestions: items.slice(0, 10) });
  } catch (err: any) {
    console.error("Event suggest error:", err);
    res.json({ suggestions: [] });
  }
});

// ---------------------------------------------------------------------------
// Event autocomplete — lightweight typeahead for the new input flow
// ---------------------------------------------------------------------------

/** GET /events/autocomplete?q={query} — fast typeahead results */
router.get("/events/autocomplete", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string || "").trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }

    // Use user's neighborhood to filter by city for more relevant results
    const dbUser = await getDbUser(req.uid!);
    const userCity = normalizeEventSearchCity(dbUser);

    const results: { id: string; title: string; venue: string; type: string }[] = [];

    const searchTicketmasterAutocomplete = async (city?: string) => {
      if (!TICKETMASTER_API_KEY) return;
      const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
      url.searchParams.set("apikey", TICKETMASTER_API_KEY);
      url.searchParams.set("keyword", q);
      url.searchParams.set("size", "20");
      url.searchParams.set("sort", "relevance,desc");
      if (userCity) {
        url.searchParams.set("city", userCity);
      }

      const resp = await fetch(url.toString());
      if (resp.ok) {
        const data = await resp.json();
        const events = data._embedded?.events || [];
        // Deduplicate by normalized title — same show with multiple showtimes should appear once
        const seenTitles = new Set<string>();
        for (const ev of events) {
          const normTitle = normalizeTitle(ev.name || "");
          if (seenTitles.has(normTitle)) continue;
          seenTitles.add(normTitle);
          const venue = ev._embedded?.venues?.[0];
          const segment = ev.classifications?.[0]?.segment?.name || "Event";
          results.push({
            id: `tm-${ev.id}`,
            title: ev.name || "",
            venue: venue?.name || "",
            type: segment,
          });
        }
      }
    };

    const searchSeatGeekAutocomplete = async (city?: string) => {
      if (!SEATGEEK_CLIENT_ID) return;
      const url = new URL("https://api.seatgeek.com/2/events");
      url.searchParams.set("client_id", SEATGEEK_CLIENT_ID);
      url.searchParams.set("q", q);
      url.searchParams.set("per_page", "20");
      if (city) {
        url.searchParams.set("venue.city", city);
      }
      const resp = await fetch(url.toString());
      if (resp.ok) {
        const data = await resp.json();
        const seenTitles = new Set<string>();
        for (const ev of (data.events || [])) {
          const normTitle = normalizeTitle(ev.short_title || ev.title || "");
          if (seenTitles.has(normTitle)) continue;
          seenTitles.add(normTitle);
          const typeName = ev.type || ev.taxonomies?.[0]?.name || "Event";
          results.push({
            id: `sg-${ev.id}`,
            title: ev.short_title || ev.title || "",
            venue: ev.venue?.name || "",
            type: typeName.charAt(0).toUpperCase() + typeName.slice(1),
          });
        }
      }
    };

    if (TICKETMASTER_API_KEY) {
      await searchTicketmasterAutocomplete(userCity);
      if (results.length === 0 && userCity) {
        await searchTicketmasterAutocomplete();
      }
    }

    // Fallback to SeatGeek if Ticketmaster returned nothing
    if (results.length === 0 && SEATGEEK_CLIENT_ID) {
      await searchSeatGeekAutocomplete(userCity);
      if (results.length === 0 && userCity) {
        await searchSeatGeekAutocomplete();
      }
    }

    res.json(results.slice(0, 8));
  } catch (err: any) {
    console.error("Event autocomplete error:", err);
    res.json([]);
  }
});

// ---------------------------------------------------------------------------
// Event from URL — extract event details from a ticketing URL
// ---------------------------------------------------------------------------

/** POST /events/from-url — accepts a Ticketmaster/SeatGeek URL, returns event details + showtimes */
router.post("/events/from-url", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { url: eventUrl } = req.body;
    if (!eventUrl || typeof eventUrl !== "string") {
      res.status(400).json({ error: "URL is required" });
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(eventUrl);
    } catch (err) { console.error(err);
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    const hostname = parsed.hostname.replace("www.", "");

    // --- Ticketmaster URL ---
    if (hostname === "ticketmaster.com" || hostname === "ticketmaster.co.uk") {
      // URL pattern: /event-name/.../event/{EVENT_ID}
      const eventIdMatch = parsed.pathname.match(/\/event\/([A-Za-z0-9]+)/);
      if (!eventIdMatch) {
        // Try alternate pattern: last path segment after last slash
        const slugMatch = parsed.pathname.match(/\/([^/]+)$/);
        if (!slugMatch) {
          res.status(400).json({ error: "Could not extract event ID from Ticketmaster URL" });
          return;
        }
      }

      const tmEventId = eventIdMatch?.[1];
      if (!tmEventId || !TICKETMASTER_API_KEY) {
        res.status(400).json({ error: "Could not extract event ID or Ticketmaster API not configured" });
        return;
      }

      // Fetch event details
      const detailUrl = `https://app.ticketmaster.com/discovery/v2/events/${tmEventId}.json?apikey=${TICKETMASTER_API_KEY}`;
      const detailResp = await fetch(detailUrl);
      if (!detailResp.ok) {
        res.status(404).json({ error: "Event not found on Ticketmaster" });
        return;
      }
      const ev = await detailResp.json();

      const title = ev.name || "";
      const venue = ev._embedded?.venues?.[0];
      const segment = ev.classifications?.[0]?.segment?.name || "Event";

      // Search for all showtimes of this event (same attraction/name)
      const attractionId = ev._embedded?.attractions?.[0]?.id;
      let showtimes: any[] = [];

      if (attractionId) {
        const stUrl = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
        stUrl.searchParams.set("apikey", TICKETMASTER_API_KEY);
        stUrl.searchParams.set("attractionId", attractionId);
        if (venue?.city?.name) stUrl.searchParams.set("city", venue.city.name);
        stUrl.searchParams.set("size", "50");
        stUrl.searchParams.set("sort", "date,asc");
        const stResp = await fetch(stUrl.toString());
        if (stResp.ok) {
          const stData = await stResp.json();
          showtimes = (stData._embedded?.events || []).map((s: any) => {
            const startDate = s.dates?.start;
            const prices = s.priceRanges?.[0];
            return {
              datetime: startDate?.dateTime || "",
              datetimeLocal: startDate?.localDate
                ? `${startDate.localDate}T${startDate.localTime || "19:00:00"}`
                : startDate?.dateTime || "",
              dateOnly: !startDate?.dateTime && !!startDate?.localDate,
              ticketUrl: s.url || eventUrl,
              price: prices ? { min: prices.min, max: prices.max } : undefined,
            };
          });
        }
      }

      // If no attraction-based search, return single showtime from the event itself
      if (showtimes.length === 0) {
        const startDate = ev.dates?.start;
        const prices = ev.priceRanges?.[0];
        showtimes = [{
          datetime: startDate?.dateTime || "",
          datetimeLocal: startDate?.localDate
            ? `${startDate.localDate}T${startDate.localTime || "19:00:00"}`
            : startDate?.dateTime || "",
          dateOnly: !startDate?.dateTime && !!startDate?.localDate,
          ticketUrl: ev.url || eventUrl,
          price: prices ? { min: prices.min, max: prices.max } : undefined,
        }];
      }

      res.json({
        event: {
          title,
          venue: venue?.name || "",
          city: venue?.city?.name || "",
          type: segment,
          imageUrl: ev.images?.find((img: any) => img.ratio === "16_9" && img.width >= 500)?.url
            || ev.images?.[0]?.url || "",
        },
        showtimes,
        totalShowtimes: showtimes.length,
      });
      return;
    }

    // --- SeatGeek URL ---
    if (hostname === "seatgeek.com") {
      // URL pattern: /event-name-tickets/... or /event-name-EVENTID
      // SeatGeek slugs often end with a numeric ID or have /e/EVENT_ID
      const slugMatch = parsed.pathname.match(/\/([^/]+?)(?:-tickets)?(?:\/([^/]+))?$/);
      const slug = slugMatch?.[1] || "";

      if (!SEATGEEK_CLIENT_ID) {
        res.status(400).json({ error: "SeatGeek API not configured" });
        return;
      }

      // Search SeatGeek by the slug/title
      const searchQuery = slug.replace(/-/g, " ").replace(/tickets$/i, "").trim();
      const sgUrl = new URL("https://api.seatgeek.com/2/events");
      sgUrl.searchParams.set("client_id", SEATGEEK_CLIENT_ID);
      sgUrl.searchParams.set("q", searchQuery);
      sgUrl.searchParams.set("per_page", "50");
      sgUrl.searchParams.set("sort", "datetime_utc.asc");

      const sgResp = await fetch(sgUrl.toString());
      if (!sgResp.ok) {
        res.status(502).json({ error: "SeatGeek API error" });
        return;
      }
      const sgData = await sgResp.json();
      const sgEvents = sgData.events || [];

      if (sgEvents.length === 0) {
        res.status(404).json({ error: "Event not found on SeatGeek" });
        return;
      }

      const firstEvent = sgEvents[0];
      const showtimes = sgEvents.map((ev: any) => ({
        datetime: ev.datetime_utc ? (ev.datetime_utc.endsWith("Z") ? ev.datetime_utc : ev.datetime_utc + "Z") : "",
        datetimeLocal: ev.datetime_local || ev.datetime_utc || "",
        dateOnly: false,
        ticketUrl: ev.url || eventUrl,
        price: ev.stats?.lowest_sg_base_price
          ? { min: ev.stats.lowest_sg_base_price, max: ev.stats.highest_price || ev.stats.lowest_sg_base_price }
          : undefined,
      }));

      res.json({
        event: {
          title: firstEvent.short_title || firstEvent.title || "",
          venue: firstEvent.venue?.name || "",
          city: firstEvent.venue?.city || "",
          type: (firstEvent.type || firstEvent.taxonomies?.[0]?.name || "Event"),
          imageUrl: firstEvent.performers?.[0]?.image || "",
        },
        showtimes,
        totalShowtimes: showtimes.length,
      });
      return;
    }

    // --- Unknown URL: attempt page title scrape as fallback ---
    try {
      const pageResp = await fetch(eventUrl, {
        headers: { "User-Agent": "SlottedBot/1.0" },
        redirect: "follow",
      });
      if (pageResp.ok) {
        const html = await pageResp.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const pageTitle = titleMatch?.[1]?.trim() || "";

        if (pageTitle) {
          res.json({
            event: {
              title: pageTitle.replace(/\s*[|\-–—].*$/, "").trim(),
              venue: "",
              city: "",
              type: "Event",
              imageUrl: "",
            },
            showtimes: [],
            totalShowtimes: 0,
            warning: "Could not extract structured data. Only page title was recovered.",
          });
          return;
        }
      }
    } catch (err) { console.error(err);
      // scrape failed — fall through
    }

    res.status(400).json({ error: "Unsupported URL. Provide a Ticketmaster or SeatGeek event link." });
  } catch (err: any) {
    console.error("Event from-url error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Event discover — browse local events by category
// ---------------------------------------------------------------------------

/** GET /events/discover — browse local popular events by category */
router.get("/events/discover", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    let city = req.query.city as string || "";
    const type = req.query.type as string || "";
    const page = parseInt(req.query.page as string || "1", 10);
    const perPage = Math.min(parseInt(req.query.perPage as string || "20", 10), 50);

    // Load user profile for city fallback and event interests
    const me = await getDbUser(req.uid!);

    if (!city) {
      const userCity = normalizeEventSearchCity(me);
      if (!userCity) {
        res.json({ events: [], message: "Set your city in Settings to discover local events." });
        return;
      }
      city = userCity;
    }

    // Date range — use query params if provided, otherwise default to next 30 days
    const dateFrom = (req.query.dateFrom as string) || new Date().toISOString().split("T")[0];
    const dateTo = (req.query.dateTo as string) || new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];

    // If no category filter specified, use the user's event interests to personalize results
    const userInterests: string[] = me?.event_interests || [];
    let searchQueries: string[] = [];

    if (!type && userInterests.length > 0) {
      // Search for each user interest separately, then merge
      searchQueries = userInterests.slice(0, 4); // limit to 4 interests to control API calls
    } else {
      searchQueries = type ? [type] : ["theater", "concert", "comedy", "sports"];
    }

    // Run searches for each interest category in parallel
    const allResultSets = await Promise.all(
      searchQueries.map(async (q) => {
        const searchParams = {
          q: q || city,
          city,
          type: type || (q !== city ? q : ""),
          dateFrom,
          dateTo,
          perPage: Math.ceil(perPage / Math.max(searchQueries.length, 1)),
        };
        const [ticketedEvents, ebEvents, muEvents, nycEvents] = await Promise.all([
          searchTicketedEvents(searchParams),
          searchEventbrite(searchParams),
          searchMeetup(searchParams),
          searchNYCOpenData(searchParams),
        ]);
        return [...ticketedEvents, ...ebEvents, ...muEvents, ...nycEvents];
      }),
    );

    const allEvents = allResultSets.flat();
    allEvents.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    // Deduplicate across interest-based queries that may return the same event
    const unique = deduplicateEvents(allEvents);

    // Paginate
    const start = (page - 1) * perPage;
    const paginated = unique.slice(start, start + perPage);

    res.json({
      events: paginated,
      total: unique.length,
      page,
      perPage,
      city,
      personalizedByInterests: !type && userInterests.length > 0,
      interests: userInterests,
      sources: {},
    });
  } catch (err: any) {
    console.error("Event discover error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** GET /events/search — search external event APIs */
router.get("/events/search", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { q, city, type, dateFrom, dateTo } = req.query as Record<string, string>;
    if (!q?.trim()) {
      res.status(400).json({ error: "Query parameter 'q' is required" });
      return;
    }

    // Waterfall: Ticketmaster first, SeatGeek fallback. Other sources in parallel.
    const [ticketedEvents, ebEvents, muEvents, nycEvents] = await Promise.all([
      searchTicketedEvents({ q, city, type, dateFrom, dateTo }),
      searchEventbrite({ q, city, type, dateFrom, dateTo }),
      searchMeetup({ q, city, type, dateFrom, dateTo }),
      searchNYCOpenData({ q, city, type, dateFrom, dateTo }),
    ]);

    const allEvents = [...ticketedEvents, ...ebEvents, ...muEvents, ...nycEvents];
    allEvents.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    res.json({
      events: allEvents,
      sources: {
        ticketed: ticketedEvents.length,
        eventbrite: ebEvents.length,
        meetup: muEvents.length,
        nyc_open_data: nycEvents.length,
      },
    });
  } catch (err: any) {
    console.error("Event search error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** POST /events/match — search events AND cross-reference with friends' availability */
router.post("/events/match", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { query: q, friendIds, city, type, dateFrom, dateTo } = req.body;
    if (!q?.trim()) {
      res.status(400).json({ error: "Query is required" });
      return;
    }
    if (!Array.isArray(friendIds) || friendIds.length === 0) {
      res.status(400).json({ error: "friendIds must be a non-empty array" });
      return;
    }

    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    // 1. Search events — waterfall for ticketed, other sources in parallel
    const [ticketedEvents, ebEvents, muEvents, nycEvents] = await Promise.all([
      searchTicketedEvents({ q, city, type, dateFrom, dateTo }),
      searchEventbrite({ q, city, type, dateFrom, dateTo }),
      searchMeetup({ q, city, type, dateFrom, dateTo }),
      searchNYCOpenData({ q, city, type, dateFrom, dateTo }),
    ]);
    const allEvents = [...ticketedEvents, ...ebEvents, ...muEvents, ...nycEvents];
    allEvents.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    // 2. Sync calendars for all participants
    const friendUsers = await Promise.all(friendIds.map((fid: string) => getDbUserById(fid)));
    const allUids = [
      req.uid!,
      ...friendUsers.map((u) => u?.firebase_uid).filter(Boolean) as string[],
    ];
    await Promise.allSettled(allUids.map((uid) => syncUserCalendar(uid)));

    // 3. Fetch free slots for all participants
    const now = new Date().toISOString();
    const sb = getSupabase();
    const allUserIds = [me.id, ...friendIds];
    const allProfiles = [me, ...friendUsers];
    const slotsByUser = await Promise.all(
      allUserIds.map((uid, idx) =>
        sb
          .from("availability")
          .select("start_time, end_time")
          .eq("user_id", uid)
          .eq("status", "free")
          .gte("end_time", now)
          .order("start_time")
          .then((r) => {
            const buffer = allProfiles[idx]?.travel_buffer_min || 0;
            return applyTravelBuffer(r.data || [], buffer);
          }),
      ),
    );

    // 4. For each event, check if its time falls within everyone's free slots
    const matches: (ExternalEvent & { availabilityScore: number; note: string })[] = [];

    for (const ev of allEvents) {
      if (!ev.datetime) continue;
      const eventStart = new Date(ev.datetime);
      const eventEnd = new Date(eventStart.getTime() + 3 * 3600000); // Assume ~3hr event

      let freeCount = 0;
      const freeNames: string[] = [];
      const busyNames: string[] = [];

      for (let i = 0; i < allUserIds.length; i++) {
        const userSlots = slotsByUser[i];
        const name = i === 0 ? "You" : (allProfiles[i]?.display_name?.split(" ")[0] || "Friend");
        let isFree = false;
        for (const slot of userSlots) {
          const slotStart = new Date(slot.start_time).getTime();
          const slotEnd = new Date(slot.end_time).getTime();
          // Check if event fits within this free slot (at least 2hr overlap)
          const overlapStart = Math.max(eventStart.getTime(), slotStart);
          const overlapEnd = Math.min(eventEnd.getTime(), slotEnd);
          if (overlapEnd - overlapStart >= 2 * 3600000) {
            isFree = true;
            break;
          }
        }
        if (isFree) {
          freeCount++;
          freeNames.push(name);
        } else {
          busyNames.push(name);
        }
      }

      if (freeCount === 0) continue; // No one is free, skip

      const score = Math.round((freeCount / allUserIds.length) * 100);
      let note = "";
      if (freeCount === allUserIds.length) {
        note = `Everyone is free! ${freeNames.join(", ")} can all make it.`;
      } else {
        note = `${freeNames.join(", ")} ${freeNames.length === 1 ? "is" : "are"} free. ${busyNames.join(", ")} may be busy.`;
      }

      matches.push({ ...ev, availabilityScore: score, note });
    }

    // Sort matches by score (best first), then by date
    matches.sort((a, b) => b.availabilityScore - a.availabilityScore || new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

    const message = matches.length > 0
      ? `Found ${matches.length} showtime${matches.length !== 1 ? "s" : ""} that work for ${freeCount(matches)} of your group.`
      : "No showtimes match everyone's availability. Try expanding the date range.";

    res.json({
      events: allEvents,
      matches,
      message,
      sources: {
        ticketed: ticketedEvents.length,
      },
    });
  } catch (err: any) {
    console.error("Event match error:", err);
    res.status(500).json({ error: err.message });
  }
});

/** Helper for match message */
function freeCount(matches: { availabilityScore: number }[]) {
  const best = matches[0]?.availabilityScore || 0;
  return best >= 100 ? "everyone" : "some";
}

function isPreferredShowtime(datetime: string) {
  const dateMatch = datetime.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!dateMatch) return true;

  const [, datePart, hourPart] = dateMatch;
  const day = new Date(`${datePart}T12:00:00Z`).getUTCDay();
  const isWeekend = day === 0 || day === 6;
  if (isWeekend || !hourPart) return true;

  return Number(hourPart) >= 17;
}

/** POST /events/schedule — event-anchored group scheduling with detailed availability */
router.post("/events/schedule", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { query: q, friendIds, location, dateRange, dateRanges } = req.body;
    if (!q?.trim()) {
      res.status(400).json({ error: "Query is required" });
      return;
    }
    // Friends are optional — event browsing works solo
    const requestedFriendIds: string[] = Array.isArray(friendIds)
      ? [...new Set(friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid))]
      : [];

    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    // Validate friendIds are accepted friends (if any provided)
    const acceptedFriendIds = requestedFriendIds.length > 0 ? await getAcceptedFriendIdSet(me.id) : new Set<string>();
    const validFriendIds = requestedFriendIds.filter((fid) => fid !== me.id && (requestedFriendIds.length === 0 || acceptedFriendIds.has(fid)));

    const today = new Date().toISOString().split("T")[0];
    const usingExplicitDateRanges = Array.isArray(dateRanges);
    const requestedDateRanges: { start: string; end?: string }[] = usingExplicitDateRanges
      ? dateRanges
        .filter((range: any) => typeof range?.start === "string" && range.start)
        .map((range: any) => ({
          start: range.start,
          end: typeof range.end === "string" && range.end ? range.end : undefined,
        }))
      : [{
        start: typeof dateRange?.start === "string" && dateRange.start ? dateRange.start : today,
        end: typeof dateRange?.end === "string" && dateRange.end ? dateRange.end : undefined,
      }];

    for (const range of requestedDateRanges) {
      if (range.end && range.end < range.start) {
        res.status(400).json({ error: "End date must be on or after start date" });
        return;
      }
    }

    // 1. Search events (Ticketmaster-first waterfall)
    // Use perPage=200 (Ticketmaster max) to get ALL showtimes for a run
    const eventSets = await Promise.all(
      requestedDateRanges.map((range) => searchTicketedEvents({
        q,
        city: location,
        dateFrom: range.start,
        dateTo: range.end,
        perPage: 200,
      })),
    );
    const events = deduplicateEvents(eventSets.flat());

    if (events.length === 0) {
      res.json({ event: null, showtimes: [], message: "No events found for that query." });
      return;
    }

    // Group events by normalized title to identify the primary event
    const primaryTitle = normalizeTitle(events[0].title);
    const matchingEvents = events.filter((e) => titlesMatch(normalizeTitle(e.title), primaryTitle));

    // Specific date-window searches should return the chosen range, not just the first few dates.
    const showtimeLimit = usingExplicitDateRanges ? 80 : 24;
    const now = new Date();
    const upcomingEvents = matchingEvents
      .filter((e) => {
        const dt = e.datetimeLocal || e.datetime;
        return dt && new Date(dt) > now;
      })
      .filter((e) => isPreferredShowtime(e.datetimeLocal || e.datetime))
      .sort((a, b) => new Date(a.datetimeLocal || a.datetime).getTime() - new Date(b.datetimeLocal || b.datetime).getTime())
      .slice(0, showtimeLimit);

    if (upcomingEvents.length === 0) {
      res.json({ event: null, showtimes: [], message: "No weekday evening or weekend showtimes found." });
      return;
    }

    const eventInfo = {
      title: matchingEvents[0].title,
      venue: matchingEvents[0].venue,
      city: matchingEvents[0].city,
      type: matchingEvents[0].type,
      imageUrl: matchingEvents[0].imageUrl,
    };

    // 2. Fetch friend DB records + check calendar connectivity via OAuth tokens
    const friendUsers = await Promise.all(validFriendIds.map((fid: string) => getDbUserById(fid)));

    // Determine calendar connectivity by checking actual OAuth tokens (not strictCalendarCheck
    // which requires recent busy blocks and fails for users with empty calendars)
    const hasCalendarConnected = (user: any): boolean => {
      if (!user) return false;
      return !!(
        user.google_refresh_token ||
        (user.outlook_calendar_connected && user.outlook_refresh_token) ||
        (user.apple_calendar_connected && user.apple_caldav_username && user.apple_caldav_password)
      );
    };

    const meCalendarConnected = hasCalendarConnected(me);
    const friendCalendarConnected = friendUsers.map((fu) => hasCalendarConnected(fu));

    // 3. Get authenticated calendar clients for direct freeBusy checks
    const allProfiles = [me, ...friendUsers];
    const allFirebaseUids = [
      req.uid!,
      ...friendUsers.map((u) => u?.firebase_uid).filter(Boolean) as string[],
    ];

    // Build per-user Google Calendar clients (null if unavailable)
    const calendarClients = await Promise.all(
      allProfiles.map(async (profile, idx) => {
        if (!profile) return null;
        const isMe = idx === 0;
        const calConnected = isMe ? meCalendarConnected : friendCalendarConnected[idx - 1];
        if (!calConnected) return null;
        const fbUid = isMe ? req.uid! : profile.firebase_uid;
        if (!fbUid) return null;
        try {
          return await getAuthedCalendarClient(fbUid);
        } catch (err) {
          console.error(`Failed to get calendar client for user ${profile.id}:`, err);
          return null;
        }
      }),
    );

    // 4. For each showtime, check per-person availability via direct freeBusy API
    const DEFAULT_SHOW_DURATION_MS = 2.5 * 3600000; // 2.5 hours for theater
    const PRE_BUFFER_MS = 1 * 3600000; // 1 hour before
    const POST_BUFFER_MS = 30 * 60000; // 30 min after

    const allUserIds = [me.id, ...validFriendIds];
    const participantNames = [
      me.display_name?.split(" ")[0] || "You",
      ...friendUsers.map((u) => u?.display_name?.split(" ")[0] || "Friend"),
    ];

    const showtimes: any[] = [];

    for (const ev of upcomingEvents) {
      const dtValue = ev.datetimeLocal || ev.datetime;
      if (!dtValue) continue; // skip events with no datetime

      const eventStart = new Date(dtValue);
      if (isNaN(eventStart.getTime())) continue;

      const showDurationMs = DEFAULT_SHOW_DURATION_MS;
      const windowStart = new Date(eventStart.getTime() - PRE_BUFFER_MS);
      const windowEnd = new Date(eventStart.getTime() + showDurationMs + POST_BUFFER_MS);

      // Privacy: aggregate availability counters only. We never expose
      // which named friend is busy or has an unconnected calendar back
      // to the caller — they only learn an aggregate state.
      let busyCount = 0;
      let checkFailedCount = 0;
      let calendarNotConnectedCount = 0;

      for (let i = 0; i < allProfiles.length; i++) {
        const name = participantNames[i];
        const profile = allProfiles[i];
        const isMe = i === 0;
        const calConnected = isMe ? meCalendarConnected : friendCalendarConnected[i - 1];

        if (!calConnected) {
          calendarNotConnectedCount++;
          continue;
        }

        const client = calendarClients[i]; // may be null if no Google calendar

        // Direct freeBusy check for this specific time window
        // Check ALL connected calendar sources (Google, Apple, Outlook)
        let isBusy = false;
        let sourcesAttempted = 0;
        let sourcesSucceeded = 0;

        // --- Google Calendar freeBusy ---
        if (client && profile?.google_refresh_token) {
          sourcesAttempted++;
          try {
            const calendarApi = google.calendar({ version: "v3", auth: client });
            const freeBusyRes = await calendarApi.freebusy.query({
              requestBody: {
                timeMin: windowStart.toISOString(),
                timeMax: windowEnd.toISOString(),
                items: [{ id: "primary" }],
              },
            });

            const busySlots = freeBusyRes.data.calendars?.primary?.busy || [];
            const errors = freeBusyRes.data.calendars?.primary?.errors;

            if (errors && errors.length > 0) {
              console.warn(`freeBusy errors for user ${profile?.id}:`, errors);
            } else {
              sourcesSucceeded++;
              if (busySlots.length > 0) {
                isBusy = true;
              }
            }
          } catch (err: any) {
            console.error(`Google freeBusy API failed for user ${profile?.id}:`, err?.message || err);
          }
        }

        // --- Apple Calendar (CalDAV) ---
        if (!isBusy && profile?.apple_calendar_connected && profile?.apple_caldav_username && profile?.apple_caldav_password) {
          sourcesAttempted++;
          try {
            const sb = getSupabase();
            const { data: selectedAppleCals } = await sb
              .from("user_calendars")
              .select("calendar_id")
              .eq("user_id", profile.id)
              .eq("is_selected", true)
              .eq("source", "apple");

            const appleCalUrls = selectedAppleCals?.map((c: any) => c.calendar_id) || [];
            if (appleCalUrls.length > 0) {
              const appleBlocks = await fetchAppleBusyBlocks(
                profile.apple_caldav_username,
                profile.apple_caldav_password,
                appleCalUrls,
                windowStart,
                windowEnd,
              );
              sourcesSucceeded++;
              if (appleBlocks.length > 0) {
                isBusy = true;
              }
            } else {
              sourcesSucceeded++;
            }
          } catch (err: any) {
            console.error(`Apple CalDAV check failed for user ${profile?.id}:`, err?.message || err);
          }
        }

        // --- Outlook Calendar ---
        if (!isBusy && profile?.outlook_calendar_connected && profile?.outlook_refresh_token) {
          sourcesAttempted++;
          try {
            const fbUid = isMe ? req.uid! : profile.firebase_uid;
            const graphClient = fbUid ? await getOutlookGraphClient(fbUid) : null;
            if (graphClient) {
              const sb = getSupabase();
              const { data: selectedOutlookCals } = await sb
                .from("user_calendars")
                .select("calendar_id")
                .eq("user_id", profile.id)
                .eq("is_selected", true)
                .eq("source", "outlook");

              let outlookSucceeded = false;
              for (const cal of selectedOutlookCals || []) {
                try {
                  const eventsRes = await graphClient
                    .api(`/me/calendars/${cal.calendar_id}/calendarView`)
                    .query({
                      startDateTime: windowStart.toISOString(),
                      endDateTime: windowEnd.toISOString(),
                    })
                    .select("start,end,showAs")
                    .top(50)
                    .get();
                  outlookSucceeded = true;
                  const outlookEvents = eventsRes?.value || [];
                  const hasBusyEvent = outlookEvents.some((e: any) => e.showAs !== "free");
                  if (hasBusyEvent) {
                    isBusy = true;
                    break;
                  }
                } catch (calErr) {
                  console.error(`Outlook calendar ${cal.calendar_id} check failed:`, calErr);
                }
              }
              if (outlookSucceeded) sourcesSucceeded++;
            }
          } catch (err: any) {
            console.error(`Outlook check failed for user ${profile?.id}:`, err?.message || err);
          }
        }

        // Only report "calendar_check_failed" if ALL attempted sources failed.
        // If at least one source succeeded, we have enough data to trust the result.
        if (isBusy) {
          busyCount++;
        } else if (sourcesAttempted > 0 && sourcesSucceeded === 0) {
          checkFailedCount++;
        }
        // (We do NOT track per-name "free" — clients don't need that detail.)
        void name; // name no longer surfaced in the response (privacy)
      }

      const totalParticipants = allProfiles.length;
      const incompleteCount = checkFailedCount + calendarNotConnectedCount;
      const availabilityState: 'all_clear' | 'some_busy' | 'check_incomplete' =
        busyCount > 0
          ? 'some_busy'
          : incompleteCount > 0
            ? 'check_incomplete'
            : 'all_clear';

      showtimes.push({
        datetime: dtValue,
        available: busyCount === 0 && incompleteCount === 0,
        availabilityState,
        totalParticipants,
        busyCount,
        checkFailedCount: incompleteCount,
        ticketUrl: ev.url,
        price: { min: ev.priceMin || null, max: ev.priceMax || null },
      });
    }

    // Keep showtimes chronological; availability is shown on each card without changing date order.
    showtimes.sort((a: any, b: any) => {
      const aTime = a.datetime ? new Date(a.datetime).getTime() : 0;
      const bTime = b.datetime ? new Date(b.datetime).getTime() : 0;
      return aTime - bTime;
    });

    res.json({
      event: eventInfo,
      showtimes,
      totalShowtimes: matchingEvents.length,
      showingCount: upcomingEvents.length,
      participants: participantNames,
    });
  } catch (err: any) {
    console.error("Event schedule error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Saved Events — bookmark events for later
// ---------------------------------------------------------------------------

/** POST /events/save — save/bookmark an event */
router.post("/events/save", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { event, status } = req.body;
    if (!event?.source || !event?.title) {
      res.status(400).json({ error: "Missing required event fields (source, title)" });
      return;
    }

    const externalId = event.id || crypto.randomUUID();

    const { data, error } = await getSupabase()
      .from("saved_events")
      .upsert(
        {
          user_id: me.id,
          external_id: externalId,
          source: event.source,
          title: event.title,
          event_type: event.type || null,
          venue: event.venue || event.location || null,
          city: event.city || null,
          datetime_utc: event.datetime || event.start || new Date().toISOString(),
          datetime_local: event.datetimeLocal || event.end || null,
          url: event.url || null,
          image_url: event.imageUrl || null,
          price_min: event.priceMin || null,
          price_max: event.priceMax || null,
          performers: event.performers || [],
          status: status || "saved",
        },
        { onConflict: "user_id,external_id,source" },
      )
      .select()
      .maybeSingle();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /events/saved — get user's saved events */
router.get("/events/saved", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const status = req.query.status as string || undefined;
    let query = getSupabase()
      .from("saved_events")
      .select("*")
      .eq("user_id", me.id)
      .order("datetime_utc", { ascending: true });

    if (status) {
      query = query.eq("status", status);
    } else {
      query = query.neq("status", "dismissed");
    }

    const { data, error } = await query;
    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ events: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /events/saved/:id — remove a saved event */
router.delete("/events/saved/:id", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { error } = await getSupabase()
      .from("saved_events")
      .delete()
      .eq("id", req.params.id)
      .eq("user_id", me.id);

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /events/saved/:id — update status of a saved event */
router.patch("/events/saved/:id", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { status, notes } = req.body;
    const updates: Record<string, any> = {};
    if (status) updates.status = status;
    if (notes !== undefined) updates.notes = notes;

    if (Object.keys(updates).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("saved_events")
      .update(updates)
      .eq("id", req.params.id)
      .eq("user_id", me.id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /events/invite — invite friends to a saved event */
router.post("/events/invite", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { savedEventId, friendIds } = req.body;
    if (!savedEventId || !Array.isArray(friendIds) || friendIds.length === 0) {
      res.status(400).json({ error: "savedEventId and friendIds are required" });
      return;
    }

    const requestedFriendIds = [...new Set(
      friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid && fid !== me.id),
    )];
    if (requestedFriendIds.length === 0) {
      res.status(400).json({ error: "friendIds must include at least one valid friend id" });
      return;
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedFriendIds = requestedFriendIds.filter((fid) => !acceptedFriendIds.has(fid));
    if (unauthorizedFriendIds.length > 0) {
      res.status(403).json({ error: "All friendIds must be accepted friends" });
      return;
    }

    // Verify the saved event belongs to this user
    const { data: savedEvent } = await getSupabase()
      .from("saved_events")
      .select("*")
      .eq("id", savedEventId)
      .eq("user_id", me.id)
      .maybeSingle();

    if (!savedEvent) {
      res.status(404).json({ error: "Saved event not found" });
      return;
    }

    // Create invites and notifications
    const results = [];
    for (const friendId of requestedFriendIds) {
      const { data: invite, error } = await getSupabase()
        .from("event_invites")
        .upsert(
          {
            saved_event_id: savedEventId,
            invited_by: me.id,
            invited_user_id: friendId,
          },
          { onConflict: "saved_event_id,invited_user_id" },
        )
        .select()
        .maybeSingle();

      if (!error && invite) {
        results.push(invite);
        // Send notification
        await createNotification({
          userId: friendId,
          type: "event_poll_update",
          title: `${me.display_name || "A friend"} wants to go to ${savedEvent.title}!`,
          body: `You've been invited to ${savedEvent.title} on ${new Date(savedEvent.datetime_utc).toLocaleDateString()}. Check it out!`,
          relatedUserId: me.id,
          relatedId: savedEventId,
        });
      }
    }

    res.json({ invites: results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /events/invites — get event invites received by the current user */
router.get("/events/invites", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { data, error } = await getSupabase()
      .from("event_invites")
      .select(`
        *,
        saved_event:saved_event_id (
          title, venue, city, datetime_utc, datetime_local, url, image_url, 
          price_min, price_max, event_type, source, performers
        ),
        inviter:invited_by (display_name, photo_url)
      `)
      .eq("invited_user_id", me.id)
      .order("created_at", { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json({ invites: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** PATCH /events/invites/:id — respond to an event invite */
router.patch("/events/invites/:id", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { rsvp } = req.body;
    if (!["interested", "going", "declined"].includes(rsvp)) {
      res.status(400).json({ error: "Invalid RSVP value" });
      return;
    }

    const { data, error } = await getSupabase()
      .from("event_invites")
      .update({ rsvp })
      .eq("id", req.params.id)
      .eq("invited_user_id", me.id)
      .select()
      .single();

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /events/suggestions — smart event suggestions based on shared interests + availability
// Returns events that match shared interests between you and your friends,
// filtered by when everyone is free. Like "You and Sarah both like theater — Hamilton this Sat?"
// ---------------------------------------------------------------------------
router.get("/events/suggestions", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const myInterests: string[] = me.event_interests || [];
    const myCity = me.event_city || me.neighborhood || "";
    if (!myCity) {
      res.json({ suggestions: [], message: "Set your city in Settings to get event suggestions." });
      return;
    }

    const sb = getSupabase();

    // 1. Get all accepted friendships
    const { data: friendshipsA } = await sb.from("friendships")
      .select("user_b_id").eq("user_a_id", me.id).eq("status", "accepted");
    const { data: friendshipsB } = await sb.from("friendships")
      .select("user_a_id").eq("user_b_id", me.id).eq("status", "accepted");

    const friendIds = [
      ...(friendshipsA || []).map((f: any) => f.user_b_id),
      ...(friendshipsB || []).map((f: any) => f.user_a_id),
    ];

    if (friendIds.length === 0) {
      res.json({ suggestions: [], message: "Add friends to get personalized event suggestions!" });
      return;
    }

    // 2. Load friend profiles to find shared interests
    const { data: friendProfiles } = await sb.from("users")
      .select("id, display_name, photo_url, event_interests, event_city, neighborhood")
      .in("id", friendIds);

    // 3. Build friend-interest pairs: which friends share which interests
    const friendPairs: { friendId: string; friendName: string; friendPhoto?: string; sharedInterests: string[] }[] = [];
    for (const friend of (friendProfiles || [])) {
      const friendInterests: string[] = friend.event_interests || [];
      const shared = myInterests.filter((i: string) => friendInterests.includes(i));
      if (shared.length > 0) {
        friendPairs.push({
          friendId: friend.id,
          friendName: friend.display_name?.split(" ")[0] || "Friend",
          friendPhoto: friend.photo_url || undefined,
          sharedInterests: shared,
        });
      }
    }

    // If no shared interests, use your own interests with all friends
    const interestsToSearch = friendPairs.length > 0
      ? [...new Set(friendPairs.flatMap((p) => p.sharedInterests))]
      : myInterests.length > 0
        ? myInterests
        : ["concert", "theater"]; // default fallback

    // 4. Search for events matching shared interests
    const dateFrom = new Date().toISOString().split("T")[0];
    const dateTo = new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]; // next 2 weeks

    const allEventSets = await Promise.all(
      interestsToSearch.slice(0, 3).map(async (interest) => {
        const searchParams = { q: interest, city: myCity, type: interest, dateFrom, dateTo, perPage: 10 };
        return searchTicketedEvents(searchParams);
      }),
    );
    const allEvents = allEventSets.flat();
    if (allEvents.length === 0) {
      res.json({ suggestions: [], message: `No upcoming events matching your interests in ${myCity}.` });
      return;
    }

    // 5. Check availability for you + friends with shared interests
    const now = new Date().toISOString();
    const mySlots = await sb.from("availability")
      .select("start_time, end_time").eq("user_id", me.id).eq("status", "free").gte("end_time", now)
      .then((r) => applyTravelBuffer(r.data || [], me.travel_buffer_min || 0));

    // For each event, find which friends are free and share that interest
    const suggestions: any[] = [];

    for (const ev of allEvents.slice(0, 20)) {
      if (!ev.datetime) continue;
      const eventStart = new Date(ev.datetime);
      const eventEnd = new Date(eventStart.getTime() + 3 * 3600000); // ~3h event

      // Check if I'm free
      const imFree = mySlots.some((slot: any) => {
        const s = new Date(slot.start_time).getTime();
        const e = new Date(slot.end_time).getTime();
        return Math.min(eventEnd.getTime(), e) - Math.max(eventStart.getTime(), s) >= 2 * 3600000;
      });
      if (!imFree) continue;

      // Find friends who share the interest for this event type AND are free
      const evType = ev.type?.toLowerCase() || "";
      const matchingFriends: { id: string; name: string; photo?: string }[] = [];

      for (const pair of friendPairs) {
        const hasInterest = pair.sharedInterests.some((i) =>
          evType.includes(i) || i.includes(evType) || ev.title.toLowerCase().includes(i),
        );
        if (!hasInterest && friendPairs.length > 0) continue;

        // Check friend's availability
        const { data: friendSlots } = await sb.from("availability")
          .select("start_time, end_time").eq("user_id", pair.friendId).eq("status", "free").gte("end_time", now);

        const friendFree = (friendSlots || []).some((slot: any) => {
          const s = new Date(slot.start_time).getTime();
          const e = new Date(slot.end_time).getTime();
          return Math.min(eventEnd.getTime(), e) - Math.max(eventStart.getTime(), s) >= 2 * 3600000;
        });

        if (friendFree) {
          matchingFriends.push({ id: pair.friendId, name: pair.friendName, photo: pair.friendPhoto });
        }
      }

      if (matchingFriends.length > 0) {
        const friendNames = matchingFriends.map((f) => f.name);
        const interestLabel = interestsToSearch.find((i) =>
          evType.includes(i) || i.includes(evType),
        ) || interestsToSearch[0];

        suggestions.push({
          ...ev,
          matchingFriends,
          sharedInterest: interestLabel,
          reason: matchingFriends.length === 1
            ? `You and ${friendNames[0]} both like ${interestLabel} — and you're both free!`
            : `${friendNames.join(", ")} are all free and love ${interestLabel}!`,
          score: matchingFriends.length * 30 + (imFree ? 40 : 0) + (ev.priceMin === 0 ? 10 : 0),
        });
      }
    }

    // Sort by score
    suggestions.sort((a, b) => b.score - a.score);

    res.json({
      suggestions: suggestions.slice(0, 8),
      friendPairs: friendPairs.map((p) => ({
        friendId: p.friendId,
        friendName: p.friendName,
        friendPhoto: p.friendPhoto,
        sharedInterests: p.sharedInterests,
      })),
      interestsSearched: interestsToSearch,
    });
  } catch (err: any) {
    console.error("Event suggestions error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /events/share — share an event with friends (like Instagram DMs)
// Sends a notification to each selected friend with the event details
// ---------------------------------------------------------------------------
router.post("/events/share", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { friendIds, event, message: userMessage } = req.body;
    if (!Array.isArray(friendIds) || friendIds.length === 0) {
      res.status(400).json({ error: "friendIds must be a non-empty array" });
      return;
    }
    if (!event || !event.title) {
      res.status(400).json({ error: "event object with title is required" });
      return;
    }

    const requestedFriendIds = [...new Set(
      friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid && fid !== me.id),
    )];
    if (requestedFriendIds.length === 0) {
      res.status(400).json({ error: "friendIds must include at least one valid friend id" });
      return;
    }

    const acceptedFriendIds = await getAcceptedFriendIdSet(me.id);
    const unauthorizedFriendIds = requestedFriendIds.filter((fid) => !acceptedFriendIds.has(fid));
    if (unauthorizedFriendIds.length > 0) {
      res.status(403).json({ error: "All friendIds must be accepted friends" });
      return;
    }

    const senderName = me.display_name?.split(" ")[0] || "A friend";
    const eventDate = event.datetimeLocal
      ? new Date(event.datetimeLocal).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : "";

    // Build notification body with embedded event data for rich rendering
    // Format: [EVENT_SHARE]{json} so the frontend can parse and render a card
    const eventPayload = {
      title: event.title,
      venue: event.venue || "",
      city: event.city || "",
      datetime: event.datetime || "",
      datetimeLocal: event.datetimeLocal || "",
      url: event.url || "",
      urls: event.urls || [],
      imageUrl: event.imageUrl || "",
      type: event.type || "event",
      source: event.source || "",
      priceMin: event.priceMin,
      priceMax: event.priceMax,
      performers: event.performers || [],
      senderMessage: userMessage || "",
    };

    const notifBody = `[EVENT_SHARE]${JSON.stringify(eventPayload)}`;
    const humanTitle = `${senderName} shared an event with you!`;
    const humanPreview = `${event.title}${eventDate ? ` — ${eventDate}` : ""}${event.venue ? ` at ${event.venue}` : ""}`;

    // Determine notification type — try event_shared first, fall back to calendar_match
    let notifType = "event_shared";

    const sentTo: string[] = [];
    const errors: string[] = [];

    for (const friendId of requestedFriendIds) {
      try {
        // Try event_shared type first
        const { error } = await getSupabase().from("notifications").insert({
          user_id: friendId,
          type: notifType,
          title: humanTitle,
          body: notifBody,
          related_user_id: me.id,
        });

        if (error) {
          // If constraint violation, fall back to calendar_match
          if (error.code === "23514" && notifType === "event_shared") {
            notifType = "calendar_match";
            const { error: fallbackErr } = await getSupabase().from("notifications").insert({
              user_id: friendId,
              type: "calendar_match",
              title: humanTitle,
              body: notifBody,
              related_user_id: me.id,
            });
            if (fallbackErr) {
              errors.push(`${friendId}: ${fallbackErr.message}`);
              continue;
            }
          } else {
            errors.push(`${friendId}: ${error.message}`);
            continue;
          }
        }

        sentTo.push(friendId);

        // Also send push notification with human-readable text
        try {
          const { data: tokens } = await getSupabase()
            .from("fcm_tokens")
            .select("token")
            .eq("user_id", friendId);

          if (tokens && tokens.length > 0) {
            await Promise.allSettled(
              tokens.map((t: any) =>
                admin.messaging().send({
                  token: t.token,
                  notification: {
                    title: humanTitle,
                    body: humanPreview,
                  },
                  webpush: {
                    fcmOptions: { link: "https://slottedapp.com/notifications" },
                  },
                }).catch(() => {}),
              ),
            );
          }
        } catch (err) { console.error("Push notification failed:", err); }
      } catch (err: any) {
        errors.push(`${friendId}: ${err.message}`);
      }
    }

    res.json({
      sent: sentTo.length,
      total: requestedFriendIds.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Event Scheduling Polls — group voting on showtimes
// POST /events/poll-draft — create/update a schedule before publishing
// POST /events/poll — create/update a schedule + creator vote
// GET /events/schedules/:scheduleId — get schedule with all votes
// POST /events/schedules/:scheduleId/vote — friend submits vote
// ---------------------------------------------------------------------------

function sortShowtimesWithIndexMap(showtimes: any[]) {
  const sorted = showtimes
    .map((showtime, originalIndex) => ({ showtime, originalIndex }))
    .sort((a, b) => {
      const aTime = new Date(a.showtime?.datetime || 0).getTime();
      const bTime = new Date(b.showtime?.datetime || 0).getTime();
      return aTime - bTime;
    });
  const indexMap = new Map<number, number>();
  sorted.forEach((item, sortedIndex) => indexMap.set(item.originalIndex, sortedIndex));
  return {
    showtimes: sorted.map((item) => item.showtime),
    indexMap,
  };
}

function remapSelectedIndices(selectedIndices: unknown[], indexMap: Map<number, number>) {
  return [...new Set(selectedIndices
    .filter((index): index is number => Number.isInteger(index))
    .map((index) => indexMap.get(index))
    .filter((index): index is number => typeof index === "number"))]
    .sort((a, b) => a - b);
}

function isScheduleExpired(schedule: any) {
  return schedule.status === "expired" || (schedule.expires_at && new Date(schedule.expires_at) < new Date());
}

async function expireScheduleIfNeeded(schedule: any) {
  if (!isScheduleExpired(schedule)) return false;
  if (schedule.status !== "expired") {
    const nowIso = new Date().toISOString();
    await getSupabase()
      .from("event_schedules")
      .update({ status: "expired", invites_closed: true, invites_closed_at: schedule.invites_closed_at || nowIso })
      .eq("id", schedule.id)
      .eq("status", "voting");
  }
  return true;
}

async function expireDueEventSchedules() {
  const nowIso = new Date().toISOString();
  const { error } = await getSupabase()
    .from("event_schedules")
    .update({ status: "expired", invites_closed: true, invites_closed_at: nowIso })
    .eq("status", "voting")
    .lt("expires_at", nowIso);
  if (error) throw new Error(error.message);
}

function validateSelectedIndices(selectedIndices: unknown[], showtimeCount: number) {
  const unique = [...new Set(selectedIndices)];
  return unique.length > 0 &&
    unique.every((index) => Number.isInteger(index) && (index as number) >= 0 && (index as number) < showtimeCount)
    ? unique as number[]
    : null;
}

router.post("/events/poll-draft", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { eventScheduleId, eventTitle, eventVenue, eventImageUrl, eventUrl, showtimes, friendIds } = req.body;
    if (!eventTitle?.trim()) {
      res.status(400).json({ error: "eventTitle is required" });
      return;
    }
    if (!Array.isArray(showtimes) || showtimes.length === 0) {
      res.status(400).json({ error: "showtimes must be a non-empty array" });
      return;
    }
    const orderedShowtimes = sortShowtimesWithIndexMap(showtimes).showtimes;

    const validFriendIds = Array.isArray(friendIds)
      ? friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid && fid !== me.id)
      : [];

    if (typeof eventScheduleId === "string" && eventScheduleId) {
      const { data: existing } = await getSupabase()
        .from("event_schedules")
        .select("id")
        .eq("id", eventScheduleId)
        .eq("created_by", me.id)
        .maybeSingle();

      if (existing) {
        const { data: updated, error: updateErr } = await getSupabase()
          .from("event_schedules")
          .update({
            event_title: eventTitle.trim(),
            event_venue: eventVenue || null,
            event_image_url: eventImageUrl || null,
            event_url: eventUrl || null,
            showtimes: orderedShowtimes,
            friend_ids: validFriendIds,
            invites_closed: false,
            invites_closed_at: null,
          })
          .eq("id", eventScheduleId)
          .eq("created_by", me.id)
          .select("id")
          .maybeSingle();

        if (updateErr || !updated) {
          res.status(500).json({ error: updateErr?.message || "Failed to update draft" });
          return;
        }
        res.json({ scheduleId: updated.id, success: true });
        return;
      }
    }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .insert({
        created_by: me.id,
        event_title: eventTitle.trim(),
        event_venue: eventVenue || null,
        event_image_url: eventImageUrl || null,
        event_url: eventUrl || null,
        showtimes: orderedShowtimes,
        friend_ids: validFriendIds,
        invites_closed: false,
        invites_closed_at: null,
      })
      .select("id")
      .maybeSingle();

    if (schedErr || !schedule) {
      res.status(500).json({ error: schedErr?.message || "Failed to save draft" });
      return;
    }

    res.json({ scheduleId: schedule.id, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/poll", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { eventScheduleId, eventTitle, eventVenue, eventImageUrl, eventUrl, showtimes, friendIds, selectedIndices } = req.body;
    if (!eventTitle?.trim()) {
      res.status(400).json({ error: "eventTitle is required" });
      return;
    }
    if (!Array.isArray(showtimes) || showtimes.length === 0) {
      res.status(400).json({ error: "showtimes must be a non-empty array" });
      return;
    }
    if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
      res.status(400).json({ error: "selectedIndices must be a non-empty array" });
      return;
    }
    const ordered = sortShowtimesWithIndexMap(showtimes);
    const orderedShowtimes = ordered.showtimes;
    const orderedSelectedIndices = remapSelectedIndices(selectedIndices, ordered.indexMap);
    if (orderedSelectedIndices.length === 0) {
      res.status(400).json({ error: "selectedIndices must include valid showtime indexes" });
      return;
    }

    const validFriendIds = Array.isArray(friendIds)
      ? friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid && fid !== me.id)
      : [];

    let schedule: any = null;
    let schedErr: any = null;
    if (typeof eventScheduleId === "string" && eventScheduleId) {
      const { data, error } = await getSupabase()
        .from("event_schedules")
        .update({
          event_title: eventTitle.trim(),
          event_venue: eventVenue || null,
          event_image_url: eventImageUrl || null,
          event_url: eventUrl || null,
          showtimes: orderedShowtimes,
          friend_ids: validFriendIds,
          invites_closed: false,
          invites_closed_at: null,
        })
        .eq("id", eventScheduleId)
        .eq("created_by", me.id)
        .select()
        .maybeSingle();
      schedule = data;
      schedErr = error;
    }

    if (!schedule && !schedErr) {
      const { data, error } = await getSupabase()
        .from("event_schedules")
        .insert({
          created_by: me.id,
          event_title: eventTitle.trim(),
          event_venue: eventVenue || null,
          event_image_url: eventImageUrl || null,
          event_url: eventUrl || null,
          showtimes: orderedShowtimes,
          friend_ids: validFriendIds,
          invites_closed: false,
          invites_closed_at: null,
        })
        .select()
        .maybeSingle();
      schedule = data;
      schedErr = error;
    }

    if (schedErr || !schedule) {
      res.status(500).json({ error: schedErr?.message || "Failed to create schedule" });
      return;
    }

    // Record creator's vote
    const { error: voteErr } = await getSupabase()
      .from("event_schedule_votes")
      .upsert(
        {
           schedule_id: schedule.id,
           user_id: me.id,
           selected_indices: orderedSelectedIndices,
           voted_at: new Date().toISOString(),
         },
        { onConflict: "schedule_id,user_id" },
      );

    if (voteErr) {
      console.error("Failed to record creator vote:", voteErr.message);
    }

    // Notify each friend
    const creatorName = me.display_name?.split(" ")[0] || "A friend";
    for (const friendId of validFriendIds) {
      await createNotification({
        userId: friendId,
        type: "event_poll_update",
        title: `${creatorName} wants to see ${eventTitle.trim()}!`,
        body: "Pick your dates — tap to vote on showtimes.",
        relatedUserId: me.id,
        relatedId: schedule.id,
      });
    }

    res.json({ scheduleId: schedule.id, success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/events/schedules/:scheduleId", async (req: Request, res: Response) => {
  try {
    const { scheduleId } = req.params;
    if (!scheduleId) { res.status(400).json({ error: "scheduleId is required" }); return; }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();

    if (schedErr || !schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    if (await expireScheduleIfNeeded(schedule)) {
      res.status(410).json({
        error: "This poll has expired",
        code: "poll_expired",
        lifecycleStatus: "expired",
      });
      return;
    }

    // Fetch all votes
    const { data: votes } = await getSupabase()
      .from("event_schedule_votes")
      .select("user_id, selected_indices, voted_at")
      .eq("schedule_id", scheduleId);

    // Fetch voter display names
    const voterIds = (votes || []).map((v: any) => v.user_id);
    let voterNames: Record<string, string> = {};
    if (voterIds.length > 0) {
      const { data: users } = await getSupabase()
        .from("users")
        .select("id, display_name")
        .in("id", voterIds);
      if (users) {
        for (const u of users) {
          voterNames[u.id] = u.display_name?.split(" ")[0] || "Friend";
        }
      }
    }

    // Per-showtime vote counts
    const showtimeCount = Array.isArray(schedule.showtimes) ? schedule.showtimes.length : 0;
    const voteCounts = new Array(showtimeCount).fill(0);
    const votersByShowtime: string[][] = Array.from({ length: showtimeCount }, () => []);
    for (const vote of (votes || [])) {
      for (const idx of (vote.selected_indices || [])) {
        if (idx >= 0 && idx < showtimeCount) {
          voteCounts[idx]++;
          votersByShowtime[idx].push(voterNames[vote.user_id] || "Friend");
        }
      }
    }

    res.json({
      schedule: {
        id: schedule.id,
        eventTitle: schedule.event_title,
        eventVenue: schedule.event_venue,
        eventImageUrl: schedule.event_image_url,
        eventUrl: schedule.event_url,
        showtimes: schedule.showtimes,
        status: schedule.status,
        lifecycleStatus: schedule.status === "confirmed" ? "confirmed" : "open",
        invitesClosed: Boolean(schedule.invites_closed),
        invitesClosedAt: schedule.invites_closed_at,
        confirmedAt: schedule.confirmed_at || null,
        confirmedBy: schedule.confirmed_by || null,
        confirmedSource: schedule.confirmed_source || null,
        confirmedShowtimeIndex: schedule.confirmed_showtime_index ?? null,
        confirmedMeetupId: schedule.confirmed_meetup_id || null,
        createdAt: schedule.created_at,
        expiresAt: schedule.expires_at,
      },
      votes: (votes || []).map((v: any) => ({
        userId: v.user_id,
        name: voterNames[v.user_id] || "Friend",
        selectedIndices: v.selected_indices,
        votedAt: v.voted_at,
      })),
      voteCounts,
      votersByShowtime,
      totalVoters: voterIds.length,
      totalInvited: (schedule.friend_ids || []).length + 1,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/events/schedules/:scheduleId/my-vote", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId } = req.params;
    if (!scheduleId) { res.status(400).json({ error: "scheduleId is required" }); return; }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("id, created_by, friend_ids, status, expires_at, invites_closed")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    if (await expireScheduleIfNeeded(schedule)) {
      res.status(410).json({ error: "This poll has expired", code: "poll_expired" });
      return;
    }

    const isParticipant = schedule.created_by === me.id || (schedule.friend_ids || []).includes(me.id);
    if (!isParticipant) {
      res.status(403).json({ error: "You are not part of this poll" });
      return;
    }

    const { data: vote, error: voteErr } = await getSupabase()
      .from("event_schedule_votes")
      .select("selected_indices, voted_at")
      .eq("schedule_id", scheduleId)
      .eq("user_id", me.id)
      .maybeSingle();
    if (voteErr) { res.status(500).json({ error: voteErr.message }); return; }

    res.json({
      selectedIndices: vote?.selected_indices || [],
      votedAt: vote?.voted_at || null,
      isOwner: schedule.created_by === me.id,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/events/schedules", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }
    await expireDueEventSchedules();

    const [createdRes, invitedRes] = await Promise.all([
      getSupabase()
        .from("event_schedules")
        .select("*")
        .eq("created_by", me.id)
        .neq("status", "expired")
        .order("created_at", { ascending: false })
        .limit(50),
      getSupabase()
        .from("event_schedules")
        .select("*")
        .contains("friend_ids", [me.id])
        .neq("status", "expired")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (createdRes.error) { res.status(500).json({ error: createdRes.error.message }); return; }
    if (invitedRes.error) { res.status(500).json({ error: invitedRes.error.message }); return; }

    const byId = new Map<string, any>();
    for (const schedule of [...(createdRes.data || []), ...(invitedRes.data || [])]) {
      byId.set(schedule.id, schedule);
    }
    const sortedSchedules = [...byId.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    const votesLookupIds = sortedSchedules.map((schedule) => schedule.id);
    const { data: draftCheckVotes, error: draftCheckVotesErr } = votesLookupIds.length
      ? await getSupabase()
        .from("event_schedule_votes")
        .select("schedule_id")
        .in("schedule_id", votesLookupIds)
      : { data: [], error: null };
    if (draftCheckVotesErr) { res.status(500).json({ error: draftCheckVotesErr.message }); return; }

    const scheduleIdsWithVotes = new Set((draftCheckVotes || []).map((vote: any) => vote.schedule_id));
    const eventOwnerKeyForSchedule = (schedule: any) => [
      String(schedule.event_title || "").trim().toLowerCase(),
      String(schedule.event_venue || "").trim().toLowerCase(),
      schedule.created_by,
    ].join("::");
    const duplicateKeyForSchedule = (schedule: any) => {
      const participantKey = [schedule.created_by, ...(schedule.friend_ids || [])].sort().join("|");
      return [
        String(schedule.event_title || "").trim().toLowerCase(),
        String(schedule.event_venue || "").trim().toLowerCase(),
        schedule.created_by,
        participantKey,
      ].join("::");
    };

    const hasSubstantivePollForEvent = new Set<string>();
    for (const schedule of sortedSchedules) {
      if (schedule.status !== "confirmed" && !scheduleIdsWithVotes.has(schedule.id)) continue;
      hasSubstantivePollForEvent.add(eventOwnerKeyForSchedule(schedule));
    }

    const dedupedSchedules = new Map<string, any>();
    for (const schedule of sortedSchedules) {
      const eventOwnerKey = eventOwnerKeyForSchedule(schedule);
      const isEmptyDraft = schedule.status === "voting" && !scheduleIdsWithVotes.has(schedule.id);
      if (isEmptyDraft && hasSubstantivePollForEvent.has(eventOwnerKey)) {
        continue;
      }
      const duplicateKey = duplicateKeyForSchedule(schedule);
      const existing = dedupedSchedules.get(duplicateKey);
      const existingHasVotes = existing ? scheduleIdsWithVotes.has(existing.id) : false;
      const scheduleHasVotes = scheduleIdsWithVotes.has(schedule.id);
      if (
        !existing ||
        (schedule.status === "voting" && existing.status !== "voting") ||
        (schedule.status === existing.status && scheduleHasVotes && !existingHasVotes)
      ) {
        dedupedSchedules.set(duplicateKey, schedule);
      }
    }
    const schedules = [...dedupedSchedules.values()].filter((schedule) => schedule.status === "voting");

    const scheduleIds = schedules.map((schedule) => schedule.id);
    const allUserIds = new Set<string>();
    for (const schedule of schedules) {
      allUserIds.add(schedule.created_by);
      for (const friendId of schedule.friend_ids || []) allUserIds.add(friendId);
    }

    const [{ data: votes, error: votesErr }, { data: users, error: usersErr }, { data: invites, error: invitesErr }] = await Promise.all([
      scheduleIds.length
        ? getSupabase()
          .from("event_schedule_votes")
          .select("schedule_id, user_id, selected_indices, voted_at")
          .in("schedule_id", scheduleIds)
        : Promise.resolve({ data: [], error: null }),
      allUserIds.size
        ? getSupabase()
          .from("users")
          .select("id, display_name, photo_url")
          .in("id", [...allUserIds])
        : Promise.resolve({ data: [], error: null }),
      scheduleIds.length
        ? getSupabase()
          .from("friend_invites")
          .select("event_schedule_id, token, expires_at, created_at")
          .in("event_schedule_id", scheduleIds)
          .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (votesErr) { res.status(500).json({ error: votesErr.message }); return; }
    if (usersErr) { res.status(500).json({ error: usersErr.message }); return; }
    if (invitesErr) { res.status(500).json({ error: invitesErr.message }); return; }

    const profiles = new Map((users || []).map((user: any) => [
      user.id,
      {
        name: user.display_name?.split(" ")[0] || "Friend",
        photoUrl: user.photo_url || null,
      },
    ]));
    const votesBySchedule = new Map<string, any[]>();
    for (const vote of votes || []) {
      const current = votesBySchedule.get(vote.schedule_id) || [];
      current.push(vote);
      votesBySchedule.set(vote.schedule_id, current);
    }
    const frontendUrl = process.env.FRONTEND_URL || "https://slottedapp.com";
    const inviteBySchedule = new Map<string, any>();
    for (const invite of invites || []) {
      if (!inviteBySchedule.has(invite.event_schedule_id) && new Date(invite.expires_at) >= new Date()) {
        inviteBySchedule.set(invite.event_schedule_id, invite);
      }
    }

    res.json({
      myUserId: me.id,
      schedules: schedules.map((schedule) => {
        const scheduleVotes = votesBySchedule.get(schedule.id) || [];
        const voterIds = new Set(scheduleVotes.map((vote) => vote.user_id));
        const participantIds = [schedule.created_by, ...(schedule.friend_ids || [])];
        const pendingIds = participantIds.filter((id: string) => !voterIds.has(id));
        const invite = inviteBySchedule.get(schedule.id);
        return {
          id: schedule.id,
          eventTitle: schedule.event_title,
          eventVenue: schedule.event_venue,
          eventImageUrl: schedule.event_image_url,
          showtimeCount: Array.isArray(schedule.showtimes) ? schedule.showtimes.length : 0,
          showtimes: Array.isArray(schedule.showtimes) ? schedule.showtimes : [],
          status: schedule.status,
          lifecycleStatus: schedule.status === "confirmed" ? "confirmed" : "open",
          invitesClosed: Boolean(schedule.invites_closed),
          invitesClosedAt: schedule.invites_closed_at,
          confirmedAt: schedule.confirmed_at || null,
          confirmedBy: schedule.confirmed_by || null,
          confirmedSource: schedule.confirmed_source || null,
          confirmedShowtimeIndex: schedule.confirmed_showtime_index ?? null,
          confirmedMeetupId: schedule.confirmed_meetup_id || null,
          createdAt: schedule.created_at,
          expiresAt: schedule.expires_at,
          isOwner: schedule.created_by === me.id,
          needsMyPicks: pendingIds.includes(me.id),
          inviteUrl: invite ? `${frontendUrl}/event-invite-meta/${invite.token}` : null,
          voted: scheduleVotes.map((vote) => ({
            userId: vote.user_id,
            name: profiles.get(vote.user_id)?.name || "Friend",
            photoUrl: profiles.get(vote.user_id)?.photoUrl || null,
            selectedCount: Array.isArray(vote.selected_indices) ? vote.selected_indices.length : 0,
            votedAt: vote.voted_at,
          })),
          pending: pendingIds.map((userId: string) => ({
            userId,
            name: profiles.get(userId)?.name || "Friend",
            photoUrl: profiles.get(userId)?.photoUrl || null,
          })),
        };
      }),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/schedules/:scheduleId/nudge", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId } = req.params;
    if (!scheduleId) { res.status(400).json({ error: "scheduleId is required" }); return; }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (schedule.created_by !== me.id) { res.status(403).json({ error: "Only the poll creator can nudge invitees" }); return; }

    const { data: votes, error: votesErr } = await getSupabase()
      .from("event_schedule_votes")
      .select("user_id")
      .eq("schedule_id", scheduleId);
    if (votesErr) { res.status(500).json({ error: votesErr.message }); return; }

    const voterIds = new Set((votes || []).map((vote: any) => vote.user_id));
    const pendingIds = (schedule.friend_ids || []).filter((friendId: string) => !voterIds.has(friendId));
    const fromName = me.display_name?.split(" ")[0] || "A friend";
    for (const friendId of pendingIds) {
      await createNotification({
        userId: friendId,
        type: "event_poll_update",
        title: `${fromName} is waiting on your ${schedule.event_title} picks`,
        body: "Tap the event poll link to save your availability.",
        relatedUserId: me.id,
        relatedId: schedule.id,
      });
      // Fire-and-forget email fallback so friends who haven't granted push
      // permission still hear about the nudge. Errors are swallowed inside.
      sendEventPollNudgeEmail({
        userId: friendId,
        fromName,
        eventTitle: schedule.event_title,
      }).catch((err) => console.error("[nudge] email fallback failed:", err));
    }

    res.json({ nudged: pendingIds.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/schedules/:scheduleId/participants", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId } = req.params;
    const { friendIds } = req.body as { friendIds?: string[] };
    if (!scheduleId || !Array.isArray(friendIds) || friendIds.length === 0) {
      res.status(400).json({ error: "scheduleId and friendIds are required" });
      return;
    }

    const requestedFriendIds = [...new Set(friendIds.filter((id) => typeof id === "string" && id !== me.id))];
    if (requestedFriendIds.length === 0 || requestedFriendIds.length > 20) {
      res.status(400).json({ error: "Choose between 1 and 20 friends" });
      return;
    }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (schedule.created_by !== me.id) { res.status(403).json({ error: "Only the poll creator can add people" }); return; }
    if (await expireScheduleIfNeeded(schedule)) { res.status(410).json({ error: "This poll has expired", code: "poll_expired" }); return; }
    if (schedule.status !== "voting") { res.status(400).json({ error: "Confirmed polls cannot be edited" }); return; }

    const { data: friendships, error: friendshipErr } = await getSupabase()
      .from("friendships")
      .select("user_a_id, user_b_id, status")
      .or(`user_a_id.eq.${me.id},user_b_id.eq.${me.id}`)
      .eq("status", "accepted");
    if (friendshipErr) { res.status(500).json({ error: friendshipErr.message }); return; }

    const acceptedFriendIds = new Set(
      (friendships || []).map((friendship: any) =>
        friendship.user_a_id === me.id ? friendship.user_b_id : friendship.user_a_id,
      ),
    );
    const validFriendIds = requestedFriendIds.filter((friendId) => acceptedFriendIds.has(friendId));
    if (validFriendIds.length === 0) {
      res.status(400).json({ error: "Choose friends you are already connected with" });
      return;
    }

    const currentFriendIds = Array.isArray(schedule.friend_ids) ? schedule.friend_ids : [];
    const newFriendIds = validFriendIds.filter((friendId) => !currentFriendIds.includes(friendId));
    if (newFriendIds.length === 0) {
      res.json({ success: true, added: 0, friendIds: currentFriendIds });
      return;
    }

    const updatedFriendIds = [...currentFriendIds, ...newFriendIds];
    const { error: updateErr } = await getSupabase()
      .from("event_schedules")
      .update({
        friend_ids: updatedFriendIds,
        invites_closed: false,
        invites_closed_at: null,
      })
      .eq("id", scheduleId)
      .eq("created_by", me.id);
    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

    for (const friendId of newFriendIds) {
      await createNotification({
        userId: friendId,
        type: "event_poll_update",
        title: `${me.display_name?.split(" ")[0] || "A friend"} added you to ${schedule.event_title}`,
        body: "Tap to share which dates work for you.",
        relatedUserId: me.id,
        relatedId: schedule.id,
      });
    }

    res.json({ success: true, added: newFriendIds.length, friendIds: updatedFriendIds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/schedules/:scheduleId/invites-closed", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId } = req.params;
    const closed = req.body?.closed !== false;
    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("id, created_by, status")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (schedule.created_by !== me.id) { res.status(403).json({ error: "Only the poll creator can close invites" }); return; }
    if (await expireScheduleIfNeeded(schedule)) { res.status(410).json({ error: "This poll has expired", code: "poll_expired" }); return; }
    if (schedule.status !== "voting") { res.status(400).json({ error: "Confirmed polls cannot be edited" }); return; }

    const { error: updateErr } = await getSupabase()
      .from("event_schedules")
      .update({
        invites_closed: closed,
        invites_closed_at: closed ? new Date().toISOString() : null,
      })
      .eq("id", scheduleId)
      .eq("created_by", me.id);
    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

    res.json({ success: true, invitesClosed: closed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/events/schedules/:scheduleId", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId } = req.params;
    if (!scheduleId) { res.status(400).json({ error: "scheduleId is required" }); return; }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule) { res.status(404).json({ error: "Schedule not found" }); return; }

    if (schedule.created_by === me.id) {
      const { error } = await getSupabase()
        .from("event_schedules")
        .update({ status: "expired" })
        .eq("id", scheduleId)
        .eq("created_by", me.id);
      if (error) { res.status(500).json({ error: error.message }); return; }

      res.json({ success: true, deleted: true });
      return;
    }

    const friendIds = Array.isArray(schedule.friend_ids) ? schedule.friend_ids : [];
    if (!friendIds.includes(me.id)) {
      res.status(403).json({ error: "You are not part of this poll" });
      return;
    }

    const { error: updateErr } = await getSupabase()
      .from("event_schedules")
      .update({ friend_ids: friendIds.filter((friendId: string) => friendId !== me.id) })
      .eq("id", scheduleId);
    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

    const { error: voteErr } = await getSupabase()
      .from("event_schedule_votes")
      .delete()
      .eq("schedule_id", scheduleId)
      .eq("user_id", me.id);
    if (voteErr) { res.status(500).json({ error: voteErr.message }); return; }

    res.json({ success: true, deleted: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/events/schedules/:scheduleId/showtimes/:index", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId, index } = req.params;
    const removeIndex = Number(index);
    if (!scheduleId || !Number.isInteger(removeIndex) || removeIndex < 0) {
      res.status(400).json({ error: "Valid scheduleId and showtime index are required" });
      return;
    }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (schedule.created_by !== me.id) { res.status(403).json({ error: "Only the poll creator can remove dates" }); return; }
    if (schedule.status !== "voting") { res.status(400).json({ error: "Confirmed polls cannot be edited" }); return; }

    const showtimes = Array.isArray(schedule.showtimes) ? schedule.showtimes : [];
    if (showtimes.length <= 1) {
      res.status(400).json({ error: "A poll needs at least one date option" });
      return;
    }
    if (removeIndex >= showtimes.length) {
      res.status(400).json({ error: "Showtime index is out of range" });
      return;
    }

    const updatedShowtimes = showtimes.filter((_: unknown, idx: number) => idx !== removeIndex);
    const { error: updateErr } = await getSupabase()
      .from("event_schedules")
      .update({ showtimes: updatedShowtimes })
      .eq("id", scheduleId)
      .eq("created_by", me.id);
    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

    const { data: votes, error: votesErr } = await getSupabase()
      .from("event_schedule_votes")
      .select("id, selected_indices")
      .eq("schedule_id", scheduleId);
    if (votesErr) { res.status(500).json({ error: votesErr.message }); return; }

    for (const vote of votes || []) {
      const selected = Array.isArray(vote.selected_indices) ? vote.selected_indices : [];
      const adjusted = selected
        .filter((selectedIndex: number) => selectedIndex !== removeIndex)
        .map((selectedIndex: number) => selectedIndex > removeIndex ? selectedIndex - 1 : selectedIndex);
      await getSupabase()
        .from("event_schedule_votes")
        .update({ selected_indices: adjusted, voted_at: new Date().toISOString() })
        .eq("id", vote.id);
    }

    res.json({ success: true, showtimes: updatedShowtimes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/schedules/:scheduleId/invite-link", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId } = req.params;
    if (!scheduleId) { res.status(400).json({ error: "scheduleId is required" }); return; }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule || schedule.status === "expired") {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    if (await expireScheduleIfNeeded(schedule)) {
      res.status(410).json({ error: "This poll has expired", code: "poll_expired" });
      return;
    }
    const scheduleFriendIds = Array.isArray(schedule.friend_ids) ? schedule.friend_ids : [];
    const isParticipant = schedule.created_by === me.id || scheduleFriendIds.includes(me.id);
    if (!isParticipant) {
      res.status(403).json({ error: "You are not part of this poll" });
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || "https://slottedapp.com";
    const { data: existing, error: existingErr } = await getSupabase()
      .from("friend_invites")
      .select("id, token, expires_at")
      .eq("event_schedule_id", scheduleId)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingErr) { res.status(500).json({ error: existingErr.message }); return; }

    if (existing) {
      res.json({
        inviteId: existing.id,
        inviteUrl: `${frontendUrl}/event-invite-meta/${existing.token}`,
        token: existing.token,
        expiresAt: existing.expires_at,
      });
      return;
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
    const { data: invite, error } = await getSupabase()
      .from("friend_invites")
      .insert({
        token,
        inviter_id: me.id,
        event_schedule_id: schedule.id,
        event_title: schedule.event_title,
        friend_ids: [schedule.created_by, ...scheduleFriendIds].filter((id: string) => id !== me.id),
        expires_at: expiresAt,
      })
      .select("id, token, expires_at")
      .maybeSingle();
    if (error || !invite) {
      res.status(500).json({ error: error?.message || "Failed to create invite link" });
      return;
    }

    res.json({
      inviteId: invite.id,
      inviteUrl: `${frontendUrl}/event-invite-meta/${invite.token}`,
      token: invite.token,
      expiresAt: invite.expires_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/schedules/:scheduleId/vote", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId } = req.params;
    const { selectedIndices } = req.body;
    if (!scheduleId) { res.status(400).json({ error: "scheduleId is required" }); return; }
    if (!Array.isArray(selectedIndices) || selectedIndices.length === 0) {
      res.status(400).json({ error: "selectedIndices must be a non-empty array" });
      return;
    }

    // Verify schedule exists
    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();

    if (schedErr || !schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    if (await expireScheduleIfNeeded(schedule)) {
      res.status(410).json({ error: "This poll has expired", code: "poll_expired" });
      return;
    }

    if (schedule.status !== "voting") {
      res.status(400).json({ error: "This poll is no longer accepting votes" });
      return;
    }
    const pollParticipantIds: string[] = [schedule.created_by, ...(schedule.friend_ids || [])];
    if (!pollParticipantIds.includes(me.id)) {
      res.status(403).json({ error: "You are not part of this poll" });
      return;
    }
    const showtimes = Array.isArray(schedule.showtimes) ? schedule.showtimes : [];
    const validatedSelectedIndices = validateSelectedIndices(selectedIndices, showtimes.length);
    if (!validatedSelectedIndices) {
      res.status(400).json({ error: "Choose valid dates from this poll" });
      return;
    }

    const { data: existingVote, error: existingVoteErr } = await getSupabase()
      .from("event_schedule_votes")
      .select("id")
      .eq("schedule_id", scheduleId)
      .eq("user_id", me.id)
      .maybeSingle();
    if (existingVoteErr) {
      res.status(500).json({ error: existingVoteErr.message });
      return;
    }

    // Upsert vote
    const { error: voteErr } = await getSupabase()
      .from("event_schedule_votes")
      .upsert(
        {
          schedule_id: scheduleId,
          user_id: me.id,
          selected_indices: validatedSelectedIndices,
          voted_at: new Date().toISOString(),
        },
        { onConflict: "schedule_id,user_id" },
      );

    if (voteErr) {
      res.status(500).json({ error: voteErr.message });
      return;
    }

    if (!existingVote && schedule.created_by !== me.id) {
      const voterName = me.display_name?.split(" ")[0] || "Someone";
      await createNotification({
        userId: schedule.created_by,
        type: "event_poll_update",
        title: `${voterName} shared availability for ${schedule.event_title}`,
        body: "Tap to see everyone's availability.",
        relatedUserId: me.id,
        relatedId: schedule.id,
      });
    }

    // Check if everyone in the poll, including the creator, has voted
    const { data: allVotes } = await getSupabase()
      .from("event_schedule_votes")
      .select("user_id")
      .eq("schedule_id", scheduleId);

    const voterSet = new Set((allVotes || []).map((v: any) => v.user_id));
    const allFriendsVoted = pollParticipantIds.every((uid: string) => voterSet.has(uid));

    if (schedule.invites_closed && allFriendsVoted && (schedule.friend_ids || []).length > 0 && schedule.created_by !== me.id) {
      await createNotification({
        userId: schedule.created_by,
        type: "event_poll_update",
        title: "Everyone filled out the poll 🎉",
        body: `${schedule.event_title} is ready — pick the final date.`,
        relatedUserId: me.id,
        relatedId: schedule.id,
      });
    }

    res.json({ success: true, allVotesIn: allFriendsVoted });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/schedules/:scheduleId/confirm", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { scheduleId } = req.params;
    const { selectedIndex } = req.body as { selectedIndex?: number };
    if (!scheduleId || !Number.isInteger(selectedIndex) || selectedIndex < 0) {
      res.status(400).json({ error: "Valid scheduleId and selectedIndex are required" });
      return;
    }
    const finalSelectedIndex = selectedIndex;

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule) { res.status(404).json({ error: "Schedule not found" }); return; }
    if (schedule.created_by !== me.id) { res.status(403).json({ error: "Only the poll creator can choose the final date" }); return; }
    if (await expireScheduleIfNeeded(schedule)) { res.status(410).json({ error: "This poll has expired", code: "poll_expired" }); return; }
    if (schedule.status !== "voting") { res.status(400).json({ error: "This poll is no longer accepting changes" }); return; }
    if (!schedule.invites_closed) {
      res.status(400).json({ error: "Mark invites complete before choosing the final date" });
      return;
    }

    const showtimes = Array.isArray(schedule.showtimes) ? schedule.showtimes : [];
    const selectedShowtime = showtimes[finalSelectedIndex];
    if (!selectedShowtime?.datetime) {
      res.status(400).json({ error: "Choose a valid showtime" });
      return;
    }

    const participantIds: string[] = [schedule.created_by, ...(schedule.friend_ids || [])];
    const { data: votes, error: votesErr } = await getSupabase()
      .from("event_schedule_votes")
      .select("user_id")
      .eq("schedule_id", scheduleId);
    if (votesErr) { res.status(500).json({ error: votesErr.message }); return; }

    const voterSet = new Set((votes || []).map((vote: any) => vote.user_id));
    const allVoted = participantIds.every((userId) => voterSet.has(userId));
    if (!allVoted) {
      res.status(400).json({ error: "Everyone needs to fill out the poll before choosing the final date" });
      return;
    }

    if (schedule.confirmed_meetup_id) {
      res.status(409).json({
        error: "This poll already has a confirmed event",
        existingMeetupId: schedule.confirmed_meetup_id,
      });
      return;
    }

    const startTime = parseShowtimeAsEventLocalTime(selectedShowtime.datetime);
    const endTime = new Date(startTime.getTime() + 2.5 * 3600000);
    const { data: existingMeetup } = await getSupabase()
      .from("meetups")
      .select("id")
      .eq("source_event_schedule_id", scheduleId)
      .maybeSingle();
    if (existingMeetup?.id) {
      await getSupabase()
        .from("event_schedules")
        .update({
          status: "confirmed",
          confirmed_by: me.id,
          confirmed_source: "event_poll",
          confirmed_at: new Date().toISOString(),
          confirmed_showtime_index: finalSelectedIndex,
          confirmed_meetup_id: existingMeetup.id,
        })
        .eq("id", scheduleId);
      res.status(409).json({
        error: "This poll already has a confirmed event",
        existingMeetupId: existingMeetup.id,
      });
      return;
    }

    const { data: meetup, error: meetupErr } = await getSupabase()
      .from("meetups")
      .insert({
        title: schedule.event_title,
        location: schedule.event_venue || undefined,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        created_by: schedule.created_by,
        status: "confirmed",
        source_event_schedule_id: scheduleId,
      })
      .select()
      .maybeSingle();
    if (meetupErr || !meetup) {
      res.status(500).json({ error: meetupErr?.message || "Could not confirm event" });
      return;
    }

    const { error: participantsErr } = await getSupabase()
      .from("meetup_participants")
      .insert(
        participantIds.map((userId) => ({
          meetup_id: meetup.id,
          user_id: userId,
          rsvp: "accepted",
        })),
      );
    if (participantsErr) { res.status(500).json({ error: participantsErr.message }); return; }

    const { error: updateErr } = await getSupabase()
      .from("event_schedules")
      .update({
        status: "confirmed",
        confirmed_by: me.id,
        confirmed_source: "event_poll",
        confirmed_at: new Date().toISOString(),
        confirmed_showtime_index: finalSelectedIndex,
        confirmed_meetup_id: meetup.id,
      })
      .eq("id", scheduleId);
    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

    const { data: participantUsers } = await getSupabase()
      .from("users")
      .select("id, firebase_uid, timezone")
      .in("id", participantIds);
    const participantTimeZones = new Map((participantUsers || []).map((user: any) => [user.id, user.timezone || "America/New_York"]));

    for (const userId of participantIds) {
      const timeStr = formatDateTimeForTimeZone(startTime.toISOString(), participantTimeZones.get(userId));
      await createNotification({
        userId,
        type: "meetup_confirmed",
        title: `${schedule.event_title} is confirmed! 🎉`,
        body: `Calendar invite is live for ${timeStr}.`,
        relatedUserId: me.id,
        relatedId: meetup.id,
      });
    }

    for (const participant of participantUsers || []) {
      if (participant.firebase_uid) {
        autoAddToCalendar(participant.firebase_uid, meetup).catch((err: unknown) => {
          console.warn("[CONFIRM_POLL] Auto-add to calendar failed", { userId: participant.id, err });
        });
      }
    }

    res.json({ success: true, meetupId: meetup.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /events/schedules/:scheduleId/settle
// Owner-driven manual settlement. Unlike /confirm this does NOT require:
//   - invites_closed
//   - everyone to have voted
// Body: { showtimeIndex?: number, customDatetime?: string, customLocation?: string, timeZone?: string, recipientUserIds: string[] }
// Sends notification + email to the chosen recipients only.
// ---------------------------------------------------------------------------
router.post("/events/schedules/:scheduleId/settle", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const { scheduleId } = req.params;
    const { showtimeIndex, customDatetime, customLocation, timeZone, recipientUserIds } = req.body as {
      showtimeIndex?: number;
      customDatetime?: string;
      customLocation?: string;
      timeZone?: string;
      recipientUserIds?: string[];
    };

    if (!scheduleId) {
      res.status(400).json({ error: "scheduleId is required" });
      return;
    }
    if (!Array.isArray(recipientUserIds) || recipientUserIds.length === 0) {
      res.status(400).json({ error: "recipientUserIds is required" });
      return;
    }
    const hasIndex = Number.isInteger(showtimeIndex) && (showtimeIndex as number) >= 0;
    const hasCustom = typeof customDatetime === "string" && customDatetime.trim().length > 0;
    if (hasIndex === hasCustom) {
      res.status(400).json({ error: "Provide exactly one of showtimeIndex or customDatetime" });
      return;
    }

    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (schedErr || !schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }
    if (schedule.created_by !== me.id) {
      res.status(403).json({ error: "Only the poll creator can settle this poll" });
      return;
    }
    if (schedule.confirmed_meetup_id) {
      res.status(409).json({ error: "This poll already has a confirmed event", existingMeetupId: schedule.confirmed_meetup_id });
      return;
    }
    if (schedule.status === "expired") {
      res.status(410).json({ error: "This poll has expired", code: "poll_expired" });
      return;
    }

    // Validate recipients ⊆ invited participants
    const invited = new Set<string>([schedule.created_by, ...(schedule.friend_ids || [])]);
    for (const rid of recipientUserIds) {
      if (!invited.has(rid)) {
        res.status(400).json({ error: `Recipient ${rid} is not invited to this poll` });
        return;
      }
    }

    // Resolve final date + venue + showtime index
    const showtimes: any[] = Array.isArray(schedule.showtimes) ? schedule.showtimes : [];
    let finalShowtimeIndex: number;
    let finalDatetime: string;
    let finalVenue: string | null = schedule.event_venue || null;
    let updatedShowtimes = showtimes;

    if (hasIndex) {
      finalShowtimeIndex = showtimeIndex as number;
      const picked = showtimes[finalShowtimeIndex];
      if (!picked?.datetime) {
        res.status(400).json({ error: "Invalid showtimeIndex" });
        return;
      }
      finalDatetime = picked.datetime;
    } else {
      finalDatetime = (customDatetime as string).trim();
      if (customLocation && typeof customLocation === "string" && customLocation.trim()) {
        finalVenue = customLocation.trim();
      }
      // Append the custom showtime so it's preserved + indexable
      const newShowtime: any = { datetime: finalDatetime };
      if (finalVenue && finalVenue !== schedule.event_venue) {
        newShowtime.location = finalVenue;
      }
      updatedShowtimes = [...showtimes, newShowtime];
      finalShowtimeIndex = updatedShowtimes.length - 1;
    }

    const customTimeZone = isValidTimeZone(timeZone)
      ? timeZone
      : isValidTimeZone(me.timezone)
        ? me.timezone
        : "America/New_York";
    const startTime = parseShowtimeAsEventLocalTime(finalDatetime, hasCustom ? customTimeZone : undefined);
    const endTime = new Date(startTime.getTime() + 2.5 * 3600000);

    // Create meetup with only the chosen recipients
    const { data: meetup, error: meetupErr } = await getSupabase()
      .from("meetups")
      .insert({
        title: schedule.event_title,
        location: finalVenue || undefined,
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        created_by: schedule.created_by,
        status: "confirmed",
        source_event_schedule_id: scheduleId,
      })
      .select()
      .maybeSingle();
    if (meetupErr || !meetup) {
      res.status(500).json({ error: meetupErr?.message || "Could not create meetup" });
      return;
    }

    const { error: participantsErr } = await getSupabase()
      .from("meetup_participants")
      .insert(
        recipientUserIds.map((userId) => ({
          meetup_id: meetup.id,
          user_id: userId,
          rsvp: "accepted",
        })),
      );
    if (participantsErr) {
      res.status(500).json({ error: participantsErr.message });
      return;
    }

    const scheduleUpdate: Record<string, any> = {
      status: "confirmed",
      confirmed_by: me.id,
      confirmed_source: "manual_settle",
      confirmed_at: new Date().toISOString(),
      confirmed_showtime_index: finalShowtimeIndex,
      confirmed_meetup_id: meetup.id,
    };
    if (updatedShowtimes !== showtimes) {
      scheduleUpdate.showtimes = updatedShowtimes;
    }
    let { error: updateErr } = await getSupabase()
      .from("event_schedules")
      .update(scheduleUpdate)
      .eq("id", scheduleId);
    if (updateErr && /event_schedules_confirmed_source_check|confirmed_source.*check|check.*confirmed_source/i.test(updateErr.message)) {
      scheduleUpdate.confirmed_source = "admin";
      const retry = await getSupabase()
        .from("event_schedules")
        .update(scheduleUpdate)
        .eq("id", scheduleId);
      updateErr = retry.error;
    }
    if (updateErr) {
      res.status(500).json({ error: updateErr.message });
      return;
    }

    // Notify recipients (in-app + push via createNotification, email via Resend)
    const { data: recipientUsers } = await getSupabase()
      .from("users")
      .select("id, firebase_uid, timezone, display_name")
      .in("id", recipientUserIds);
    const tzMap = new Map((recipientUsers || []).map((u: any) => [u.id, u.timezone || "America/New_York"]));
    const fromName = me.display_name?.split(" ")[0] || "A friend";

    for (const userId of recipientUserIds) {
      const timeStr = formatDateTimeForTimeZone(startTime.toISOString(), tzMap.get(userId));
      // In-app + FCM push (skip self-notify for owner)
      if (userId !== me.id) {
        await createNotification({
          userId,
          type: "meetup_confirmed",
          title: `${schedule.event_title} is confirmed! 🎉`,
          body: `Calendar invite is live for ${timeStr}.`,
          relatedUserId: me.id,
          relatedId: meetup.id,
        });
      }
      // Email fallback with calendar links (fire-and-forget), including owner.
      sendPollSettledEmail({
        userId,
        fromName,
        eventTitle: schedule.event_title,
        dateStr: timeStr,
        venue: finalVenue,
        startTime,
        endTime,
      }).catch((err: unknown) => {
        console.warn("[SETTLE_POLL] Settlement email failed", { userId, err });
      });
    }

    // Auto-add to each recipient's connected calendar
    for (const user of recipientUsers || []) {
      if (user.firebase_uid) {
        autoAddToCalendar(user.firebase_uid, meetup).catch((err: unknown) => {
          console.warn("[SETTLE_POLL] Auto-add to calendar failed", { userId: user.id, err });
        });
      }
    }

    res.json({ success: true, meetupId: meetup.id });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Event-Anchored Friend Invite Links — invite non-users to join a scheduling poll
// POST /events/friend-invite — create a shareable invite link
// GET /events/friend-invite/:token — validate invite (unauthenticated)
// POST /events/friend-invite/:token/accept — accept invite (authenticated)
// ---------------------------------------------------------------------------

router.post("/events/friend-invite", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { eventScheduleId, eventTitle, friendEmail, friendPhone, friendIds } = req.body;
    if (!eventTitle?.trim()) {
      res.status(400).json({ error: "eventTitle is required" });
      return;
    }

    // Generate URL-safe token
    const token = randomBytes(32).toString("base64url");

    // Determine expiry: default 30 days from now (frontend can pass explicit expiresAt)
    const expiresAt = req.body.expiresAt
      ? new Date(req.body.expiresAt).toISOString()
      : new Date(Date.now() + 30 * 24 * 3600000).toISOString();

    const { data: invite, error } = await getSupabase()
      .from("friend_invites")
      .insert({
        token,
        inviter_id: me.id,
        event_schedule_id: eventScheduleId || null,
        event_title: eventTitle.trim(),
        friend_ids: Array.isArray(friendIds) ? friendIds.filter((id: string) => id !== me.id) : [],
        invited_email: friendEmail?.toLowerCase() || null,
        invited_phone: friendPhone || null,
        expires_at: expiresAt,
      })
      .select()
      .maybeSingle();

    if (error) { res.status(500).json({ error: error.message }); return; }

    const frontendUrl = process.env.FRONTEND_URL || "https://slottedapp.com";
    res.json({
      inviteId: invite.id,
      inviteUrl: `${frontendUrl}/event-invite-meta/${token}`,
      token,
      expiresAt: invite.expires_at,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/events/friend-invite/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    if (!token) { res.status(400).json({ error: "Token is required" }); return; }

    const { data: invite, error } = await getSupabase()
      .from("friend_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (error || !invite) {
      res.status(404).json({ valid: false, error: "Invite not found" });
      return;
    }

    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      res.json({ valid: false, error: "This invite has expired", code: "invite_expired", inviteState: "expired" });
      return;
    }

    const [{ data: inviter }, { data: schedule }] = await Promise.all([
      getSupabase()
        .from("users")
        .select("display_name")
        .eq("id", invite.inviter_id)
        .maybeSingle(),
      invite.event_schedule_id
        ? getSupabase()
          .from("event_schedules")
          .select("id, status, expires_at, invites_closed")
          .eq("id", invite.event_schedule_id)
          .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (schedule && await expireScheduleIfNeeded(schedule)) {
      return null;
    }

    // Fetch group member first names
    const groupMembers: string[] = [];
    if (invite.friend_ids && invite.friend_ids.length > 0) {
      const { data: friends } = await getSupabase()
        .from("users")
        .select("display_name")
        .in("id", invite.friend_ids);
      if (friends) {
        for (const f of friends) {
          groupMembers.push(f.display_name?.split(" ")[0] || "Friend");
        }
      }
    }

    res.json({
      valid: true,
      eventTitle: invite.event_title,
      inviterName: inviter?.display_name?.split(" ")[0] || "A friend",
      groupMembers,
      eventScheduleId: invite.event_schedule_id || null,
      inviteState: schedule?.invites_closed ? "reused_existing_only" : "open",
      invitesClosed: Boolean(schedule?.invites_closed),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/events/friend-invite/:token/accept", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { token } = req.params;
    if (!token) { res.status(400).json({ error: "Token is required" }); return; }

    const { data: invite, error: fetchErr } = await getSupabase()
      .from("friend_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    if (fetchErr || !invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    if (new Date(invite.expires_at) < new Date()) {
      res.status(410).json({ error: "Invite has expired" });
      return;
    }

    if (invite.inviter_id === me.id) {
      res.status(400).json({ error: "Cannot accept your own invite" });
      return;
    }

    const firstTimeAcceptingLink = invite.accepted_by !== me.id;

    // Keep event links reusable for multiple recipients; first accept preserves legacy audit columns.
    if (!invite.accepted_by) {
      const { error: updateErr } = await getSupabase()
        .from("friend_invites")
        .update({ accepted_by: me.id, accepted_at: new Date().toISOString() })
        .eq("id", invite.id);

      if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }
    }

    // Auto-create friendships: invitee ↔ inviter + invitee ↔ all group members
    const allFriendTargets = [invite.inviter_id, ...(invite.friend_ids || [])].filter(
      (id: string) => id !== me.id,
    );
    const uniqueTargets = [...new Set(allFriendTargets)];

    for (const targetId of uniqueTargets) {
      const [userA, userB] = me.id < targetId ? [me.id, targetId] : [targetId, me.id];
      await getSupabase()
        .from("friendships")
        .upsert(
          {
            user_a_id: userA,
            user_b_id: userB,
            invited_by: invite.inviter_id,
            status: "accepted",
            user_a_friendship_type: "local",
            user_b_friendship_type: "local",
          },
          { onConflict: "user_a_id,user_b_id" },
        );
    }

    let userAddedToSchedule = !invite.event_schedule_id;
    let inviteState = "open";
    let alreadyInPoll = false;
    if (invite.event_schedule_id) {
      const { data: schedule, error: scheduleErr } = await getSupabase()
        .from("event_schedules")
        .select("id, created_by, friend_ids, status, expires_at, invites_closed")
        .eq("id", invite.event_schedule_id)
        .maybeSingle();
      if (scheduleErr) { res.status(500).json({ error: scheduleErr.message }); return; }

      if (schedule && await expireScheduleIfNeeded(schedule)) {
        res.status(410).json({ error: "This poll has expired", code: "poll_expired", inviteState: "expired" });
        return;
      }

      if (schedule && schedule.status === "voting" && schedule.created_by !== me.id) {
        const friendIds = Array.isArray(schedule.friend_ids) ? schedule.friend_ids : [];
        alreadyInPoll = friendIds.includes(me.id);
        if (schedule.invites_closed && !alreadyInPoll) {
          res.status(409).json({
            error: "This poll is no longer adding new people",
            code: "invites_closed",
            inviteState: "closed",
          });
          return;
        }
        if (!friendIds.includes(me.id)) {
          const { error: updateScheduleErr } = await getSupabase()
            .from("event_schedules")
            .update({ friend_ids: [...friendIds, me.id] })
            .eq("id", invite.event_schedule_id);
          if (updateScheduleErr) { res.status(500).json({ error: updateScheduleErr.message }); return; }
          userAddedToSchedule = true;
        } else {
          userAddedToSchedule = true;
          inviteState = "reused";
        }
      } else if (schedule?.created_by === me.id || schedule?.friend_ids?.includes(me.id)) {
        userAddedToSchedule = true;
        alreadyInPoll = true;
        inviteState = "reused";
      }
    }

    // Notify inviter, combining joins for the same poll instead of stacking one notification per person.
    if (firstTimeAcceptingLink) {
      const recentJoinCutoff = new Date(Date.now() - 60 * 60000).toISOString();
      const { data: recentJoinNotifications } = await getSupabase()
        .from("notifications")
        .select("id")
        .eq("user_id", invite.inviter_id)
        .eq("type", "friend_accepted")
        .eq("related_user_id", me.id)
        .gte("created_at", recentJoinCutoff)
        .limit(1);

      if (!recentJoinNotifications || recentJoinNotifications.length === 0) {
        const { data: pollJoinNotification } = await getSupabase()
          .from("notifications")
          .select("id")
          .eq("user_id", invite.inviter_id)
          .eq("type", "friend_accepted")
          .eq("related_id", invite.id)
          .limit(1)
          .maybeSingle();
        const joinedIds = invite.event_schedule_id
          ? [...new Set([...(Array.isArray(invite.friend_ids) ? invite.friend_ids : []), me.id])]
          : [me.id];
        const { data: joinedUsers } = await getSupabase()
          .from("users")
          .select("display_name")
          .in("id", joinedIds);
        const joinedNames = (joinedUsers || []).map((user: any) => user.display_name?.split(" ")[0] || "Someone");
        const joinedText = formatNameList(joinedNames);
        const body = `${joinedText || me.display_name?.split(" ")[0] || "Someone"} joined your ${invite.event_title} poll.`;
        if (pollJoinNotification?.id) {
          await getSupabase()
            .from("notifications")
            .update({
              title: `${joinedText || "Someone"} joined your poll`,
              body,
              related_user_id: me.id,
              read: false,
            })
            .eq("id", pollJoinNotification.id);
        } else {
        await createNotification({
          userId: invite.inviter_id,
          type: "friend_accepted",
          title: `${joinedText || "Someone"} joined your poll`,
          body,
          relatedUserId: me.id,
          relatedId: invite.id,
        });
        }
      }
    }

    // Trigger calendar sync for the new member
    let calendarSyncFailed = false;
    try { await syncUserCalendar(req.uid!); } catch (err) {
      calendarSyncFailed = true;
      console.error("Calendar sync failed:", err);
    }

    res.json({
      success: true,
      eventTitle: invite.event_title,
      eventScheduleId: invite.event_schedule_id || null,
      friendsCreated: uniqueTargets.length,
      userAddedToSchedule,
      inviteState,
      alreadyInPoll,
      calendarSyncFailed,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

async function getInvitePreview(token: string) {
  const { data: invite } = await getSupabase()
    .from("friend_invites")
    .select("*")
    .eq("token", token)
    .maybeSingle();

  if (!invite) return null;

  const [{ data: inviter }, { data: schedule }] = await Promise.all([
    getSupabase()
      .from("users")
      .select("display_name")
      .eq("id", invite.inviter_id)
      .maybeSingle(),
    invite.event_schedule_id
      ? getSupabase()
        .from("event_schedules")
        .select("id, status, expires_at, invites_closed, event_venue, event_image_url")
        .eq("id", invite.event_schedule_id)
        .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (schedule && await expireScheduleIfNeeded(schedule)) {
    return null;
  }

  const friendNames: string[] = [];
  if (invite.friend_ids && invite.friend_ids.length > 0) {
    const { data: friends } = await getSupabase()
      .from("users")
      .select("display_name")
      .in("id", invite.friend_ids);
    for (const friend of friends || []) {
      friendNames.push(friend.display_name?.split(" ")[0] || "Friend");
    }
  }

  const inviterName = inviter?.display_name?.split(" ")[0] || "A friend";
  const participantNames = [inviterName, ...friendNames];
  const title = invite.event_title || "an event";
  const venue = schedule?.event_venue || null;
  const withText = `with ${formatNameList(participantNames)}`;
  const participantText = formatNameList(participantNames);

  return {
    title,
    venue,
    imageUrl: typeof schedule?.event_image_url === "string" && schedule.event_image_url.startsWith("https://")
      ? schedule.event_image_url
      : null,
    inviterName,
    participantNames,
    participantText,
    withText,
    headline: `Pick a date for ${title}`,
    description: `${participantText} are finding the best showtime${venue ? ` at ${venue}` : ""}. Tap to add your availability.`,
  };
}

/** GET /event-invite-image/:token.svg — generated event-specific social image */
router.get("/event-invite-image/:token.svg", async (req: Request, res: Response) => {
  try {
    const preview = await getInvitePreview(req.params.token);
    const title = escapeHtml(truncatePreviewText(preview?.title || "Event poll", 34));
    const participantText = escapeHtml(truncatePreviewText(preview?.participantText || "friends", 46));
    const venue = escapeHtml(truncatePreviewText(preview?.venue || "Pick the showtime that works best", 48));

    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#6d28d9"/>
      <stop offset="52%" stop-color="#9333ea"/>
      <stop offset="100%" stop-color="#2563eb"/>
    </linearGradient>
    <radialGradient id="glow" cx="70%" cy="20%" r="65%">
      <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#fbbf24" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="24" flood-color="#312e81" flood-opacity="0.24"/>
    </filter>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <circle cx="1025" cy="105" r="190" fill="#ffffff" opacity="0.12"/>
  <circle cx="120" cy="560" r="240" fill="#ffffff" opacity="0.10"/>
  <rect x="82" y="72" width="1036" height="486" rx="52" fill="#ffffff" opacity="0.96" filter="url(#shadow)"/>
  <rect x="118" y="108" width="964" height="414" rx="34" fill="#faf5ff"/>
  <rect x="118" y="108" width="964" height="122" rx="34" fill="#ffffff"/>
  <text x="158" y="163" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="900" fill="#7c3aed">Slotted.ai</text>
  <rect x="842" y="132" width="198" height="46" rx="23" fill="#ede9fe"/>
  <text x="872" y="163" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="800" fill="#6d28d9">Event invite</text>
  <text x="158" y="282" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="800" fill="#4b5563">Pick a date for</text>
  <text x="158" y="370" font-family="Inter, Arial, sans-serif" font-size="76" font-weight="950" fill="#111827">${title}</text>
  <text x="158" y="432" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" fill="#6b7280">${venue}</text>
  <circle cx="180" cy="485" r="25" fill="#7c3aed"/>
  <circle cx="218" cy="485" r="25" fill="#9333ea"/>
  <circle cx="256" cy="485" r="25" fill="#2563eb"/>
  <text x="302" y="496" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="800" fill="#4b5563">${participantText}</text>
  <rect x="760" y="450" width="282" height="58" rx="29" fill="#7c3aed"/>
  <text x="803" y="487" font-family="Inter, Arial, sans-serif" font-size="25" font-weight="900" fill="#ffffff">Add your availability</text>
</svg>`);
  } catch {
    res.status(404).send("Not found");
  }
});

/** GET /event-invite-meta/:token — serves HTML with OG meta tags for link previews */
router.get("/event-invite-meta/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const frontendUrl = process.env.FRONTEND_URL || "https://slottedapp.com";
    const preview = await getInvitePreview(token);
    const title = preview?.headline || "You're invited to an event on Slotted";
    const description = preview?.description || "Pick the dates that work for you on Slotted.ai";
    // OG image must be PNG/JPEG for iMessage, WhatsApp, Slack, Twitter, etc. SVG is silently dropped.
    // Prefer real event image (Ticketmaster/SeatGeek → PNG/JPG). Fall back to the static app icon PNG.
    const hasRasterEventImage = preview?.imageUrl && /\.(png|jpe?g|webp)(\?.*)?$/i.test(preview.imageUrl);
    const imageUrl = hasRasterEventImage ? preview!.imageUrl! : `${frontendUrl}/icons/icon-512.png`;
    const imageType = /\.png(\?.*)?$/i.test(imageUrl) ? "image/png" : "image/jpeg";
    const imageWidth = hasRasterEventImage ? "1200" : "512";
    const imageHeight = hasRasterEventImage ? "630" : "512";
    const twitterCard = hasRasterEventImage ? "summary_large_image" : "summary";
    const escTitle = escapeHtml(title);
    const escDesc = escapeHtml(description);
    const escImageUrl = escapeHtml(imageUrl);

    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${escTitle}" />
  <meta property="og:description" content="${escDesc}" />
  <meta property="og:image" content="${escImageUrl}" />
  <meta property="og:image:secure_url" content="${escImageUrl}" />
  <meta property="og:image:type" content="${imageType}" />
  <meta property="og:image:width" content="${imageWidth}" />
  <meta property="og:image:height" content="${imageHeight}" />
  <meta property="og:url" content="https://slottedapp.com/event-invite/${token}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="${twitterCard}" />
  <meta name="twitter:title" content="${escTitle}" />
  <meta name="twitter:description" content="${escDesc}" />
  <meta name="twitter:image" content="${escImageUrl}" />
  <meta http-equiv="refresh" content="0;url=/event-invite/${token}">
  <title>${escTitle}</title>
</head>
<body>
  <p>Redirecting to <a href="/event-invite/${token}">Slotted.ai</a>...</p>
</body>
</html>`);
  } catch {
    res.redirect(`/invite/${req.params.token}`);
  }
});

// ---------------------------------------------------------------------------
// Flow B — Date-first event discovery ("What's happening?")
// After friends find a mutual free slot, show events during that window.
// ---------------------------------------------------------------------------

router.get("/events/whats-happening", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { date, startTime, endTime } = req.query as Record<string, string>;
    if (!date) {
      res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
      return;
    }

    const dbUser = await getDbUser(req.uid!);
    if (!dbUser) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const userCity = dbUser.event_city
      || (dbUser.neighborhood ? dbUser.neighborhood.split(",").pop()?.trim() : undefined)
      || undefined;

    const searchParams = {
      q: userCity || "events",
      city: userCity,
      dateFrom: date,
      dateTo: date,
      perPage: 30,
    };

    const [ticketedEvents, ebEvents, muEvents, nycEvents] = await Promise.all([
      searchTicketedEvents(searchParams),
      searchEventbrite(searchParams),
      searchMeetup(searchParams),
      searchNYCOpenData(searchParams),
    ]);

    let allEvents = [...ticketedEvents, ...ebEvents, ...muEvents, ...nycEvents];

    if (startTime && endTime) {
      const windowStart = new Date(`${date}T${startTime}`);
      const windowEnd = new Date(`${date}T${endTime}`);
      allEvents = allEvents.filter((ev) => {
        const evTime = new Date(ev.datetimeLocal || ev.datetime);
        return evTime >= windowStart && evTime <= windowEnd;
      });
    }

    const uniqueEvents = deduplicateEvents(allEvents);

    const typeOrder: Record<string, number> = {
      theater: 1, comedy: 2, concert: 3, sports: 4, festival: 5,
    };
    uniqueEvents.sort((a, b) => {
      const aOrder = typeOrder[a.type?.toLowerCase()] || 10;
      const bOrder = typeOrder[b.type?.toLowerCase()] || 10;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
    });

    res.json({
      date,
      city: userCity || "unknown",
      events: uniqueEvents.slice(0, 20),
      totalFound: uniqueEvents.length,
    });
  } catch (err: any) {
    console.error("What's happening error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

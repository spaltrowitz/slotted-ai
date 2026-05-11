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
} from "../utils/helpers";
import { getSupabase } from "../supabase";
import * as admin from "firebase-admin";
import { randomBytes } from "crypto";
import { google } from "googleapis";

const router = express.Router();

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
    url.searchParams.set("sort", "score.desc");

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
    url.searchParams.set("sort", "relevance,desc");

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
    const userCity = dbUser?.neighborhood
      ? dbUser.neighborhood.split(",").pop()?.trim()
      : undefined;

    const results: { id: string; title: string; venue: string; type: string }[] = [];

    if (TICKETMASTER_API_KEY) {
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
    }

    // Fallback to SeatGeek if Ticketmaster returned nothing
    if (results.length === 0 && SEATGEEK_CLIENT_ID) {
      const url = new URL("https://api.seatgeek.com/2/events");
      url.searchParams.set("client_id", SEATGEEK_CLIENT_ID);
      url.searchParams.set("q", q);
      url.searchParams.set("per_page", "20");
      if (userCity) {
        url.searchParams.set("venue.city", userCity);
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
      const userCity = me?.event_city || me?.neighborhood || "";
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
    let effectiveType = type;
    let searchQueries: string[] = [];

    if (!type && userInterests.length > 0) {
      // Search for each user interest separately, then merge
      searchQueries = userInterests.slice(0, 4); // limit to 4 interests to control API calls
    } else {
      searchQueries = [type || city];
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

/** POST /events/schedule — event-anchored group scheduling with detailed availability */
router.post("/events/schedule", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { query: q, friendIds, location, dateRange } = req.body;
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

    // 1. Search events (Ticketmaster-first waterfall)
    // Use perPage=200 (Ticketmaster max) to get ALL showtimes for a run
    const searchParams = {
      q,
      city: location,
      dateFrom: dateRange?.start,
      dateTo: dateRange?.end,
      perPage: 200,
    };
    const events = await searchTicketedEvents(searchParams);

    if (events.length === 0) {
      res.json({ event: null, showtimes: [], message: "No events found for that query." });
      return;
    }

    // Group events by normalized title to identify the primary event
    const primaryTitle = normalizeTitle(events[0].title);
    const matchingEvents = events.filter((e) => titlesMatch(normalizeTitle(e.title), primaryTitle));

    // Only check availability for the next 12 upcoming showtimes (avoid overwhelming UI + API calls)
    const now = new Date();
    const upcomingEvents = matchingEvents
      .filter((e) => {
        const dt = e.datetimeLocal || e.datetime;
        return dt && new Date(dt) > now;
      })
      .sort((a, b) => new Date(a.datetimeLocal || a.datetime).getTime() - new Date(b.datetimeLocal || b.datetime).getTime())
      .slice(0, 12);

    if (upcomingEvents.length === 0) {
      res.json({ event: null, showtimes: [], message: "No upcoming showtimes found." });
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
      const dtValue = ev.datetime || ev.datetimeLocal;
      if (!dtValue) continue; // skip events with no datetime

      const eventStart = new Date(dtValue);
      if (isNaN(eventStart.getTime())) continue;

      const showDurationMs = DEFAULT_SHOW_DURATION_MS;
      const windowStart = new Date(eventStart.getTime() - PRE_BUFFER_MS);
      const windowEnd = new Date(eventStart.getTime() + showDurationMs + POST_BUFFER_MS);

      const allFree: string[] = [];
      const conflicts: { name: string; reason: string }[] = [];

      for (let i = 0; i < allProfiles.length; i++) {
        const name = participantNames[i];
        const profile = allProfiles[i];
        const isMe = i === 0;
        const calConnected = isMe ? meCalendarConnected : friendCalendarConnected[i - 1];

        if (!calConnected) {
          conflicts.push({ name, reason: "calendar_not_connected" });
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
          conflicts.push({ name, reason: "busy" });
        } else if (sourcesAttempted > 0 && sourcesSucceeded === 0) {
          conflicts.push({ name, reason: "calendar_check_failed" });
        } else {
          allFree.push(name);
        }
      }

      showtimes.push({
        datetime: dtValue,
        available: conflicts.length === 0,
        allFree,
        conflicts,
        ticketUrl: ev.url,
        price: { min: ev.priceMin || null, max: ev.priceMax || null },
      });
    }

    // Sort: available first, then by date
    showtimes.sort((a: any, b: any) => {
      if (a.available === b.available) {
        const aTime = a.datetime ? new Date(a.datetime).getTime() : 0;
        const bTime = b.datetime ? new Date(b.datetime).getTime() : 0;
        return aTime - bTime;
      }
      if (a.available === true) return -1;
      if (b.available === true) return 1;
      if (a.available === null) return 1; // date-only at end
      return 0;
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
          type: "meetup_request",
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
                    fcmOptions: { link: "https://slotted-ai.web.app/notifications" },
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
// POST /events/poll — create a schedule + creator vote
// GET /events/schedules/:scheduleId — get schedule with all votes
// POST /events/schedules/:scheduleId/vote — friend submits vote
// ---------------------------------------------------------------------------

router.post("/events/poll", authWithRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const me = await getDbUser(req.uid!);
    if (!me) { res.status(404).json({ error: "User not found" }); return; }

    const { eventTitle, eventVenue, eventImageUrl, eventUrl, showtimes, friendIds, selectedIndices } = req.body;
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

    const validFriendIds = Array.isArray(friendIds)
      ? friendIds.filter((fid: unknown): fid is string => typeof fid === "string" && !!fid && fid !== me.id)
      : [];

    // Create the schedule
    const { data: schedule, error: schedErr } = await getSupabase()
      .from("event_schedules")
      .insert({
        created_by: me.id,
        event_title: eventTitle.trim(),
        event_venue: eventVenue || null,
        event_image_url: eventImageUrl || null,
        event_url: eventUrl || null,
        showtimes,
        friend_ids: validFriendIds,
      })
      .select()
      .maybeSingle();

    if (schedErr || !schedule) {
      res.status(500).json({ error: schedErr?.message || "Failed to create schedule" });
      return;
    }

    // Record creator's vote
    const { error: voteErr } = await getSupabase()
      .from("event_schedule_votes")
      .insert({
        schedule_id: schedule.id,
        user_id: me.id,
        selected_indices: selectedIndices,
      });

    if (voteErr) {
      console.error("Failed to record creator vote:", voteErr.message);
    }

    // Notify each friend
    const creatorName = me.display_name?.split(" ")[0] || "A friend";
    for (const friendId of validFriendIds) {
      await createNotification({
        userId: friendId,
        type: "meetup_request",
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

    if (schedule.status !== "voting") {
      res.status(400).json({ error: "This poll is no longer accepting votes" });
      return;
    }

    // Upsert vote
    const { error: voteErr } = await getSupabase()
      .from("event_schedule_votes")
      .upsert(
        {
          schedule_id: scheduleId,
          user_id: me.id,
          selected_indices: selectedIndices,
          voted_at: new Date().toISOString(),
        },
        { onConflict: "schedule_id,user_id" },
      );

    if (voteErr) {
      res.status(500).json({ error: voteErr.message });
      return;
    }

    // Notify creator
    const voterName = me.display_name?.split(" ")[0] || "Someone";
    await createNotification({
      userId: schedule.created_by,
      type: "meetup_request",
      title: `${voterName} voted on ${schedule.event_title}!`,
      body: "Tap to see everyone's availability.",
      relatedUserId: me.id,
      relatedId: schedule.id,
    });

    // Check if all invited friends have voted
    const { data: allVotes } = await getSupabase()
      .from("event_schedule_votes")
      .select("user_id")
      .eq("schedule_id", scheduleId);

    const voterSet = new Set((allVotes || []).map((v: any) => v.user_id));
    const allFriendsVoted = (schedule.friend_ids || []).every((fid: string) => voterSet.has(fid));

    if (allFriendsVoted && (schedule.friend_ids || []).length > 0) {
      // Re-fetch votes with selected_indices for tallying
      const { data: fullVotes } = await getSupabase()
        .from("event_schedule_votes")
        .select("user_id, selected_indices")
        .eq("schedule_id", scheduleId);

      const voteCounts = new Map<number, number>();
      for (const vote of (fullVotes || [])) {
        for (const idx of (vote.selected_indices || [])) {
          voteCounts.set(idx, (voteCounts.get(idx) || 0) + 1);
        }
      }

      let bestIdx = 0;
      let bestCount = 0;
      for (const [idx, count] of voteCounts) {
        if (count > bestCount) {
          bestIdx = idx;
          bestCount = count;
        }
      }

      const showtimes = (schedule.showtimes || []) as { datetime?: string }[];
      const winningShowtime = showtimes[bestIdx];

      if (winningShowtime?.datetime) {
        const startTime = new Date(winningShowtime.datetime);
        const endTime = new Date(startTime.getTime() + 2.5 * 3600000);

        const { data: meetup } = await getSupabase()
          .from("meetups")
          .insert({
            title: schedule.event_title,
            location: schedule.event_venue || undefined,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            created_by: schedule.created_by,
          })
          .select()
          .maybeSingle();

        if (meetup) {
          const allParticipantIds: string[] = [schedule.created_by, ...(schedule.friend_ids || [])];
          await getSupabase()
            .from("meetup_participants")
            .insert(
              allParticipantIds.map((uid: string) => ({
                meetup_id: meetup.id,
                user_id: uid,
                rsvp: "accepted",
              })),
            );

          await getSupabase()
            .from("meetups")
            .update({ status: "confirmed" })
            .eq("id", meetup.id);

          await getSupabase()
            .from("event_schedules")
            .update({ status: "confirmed" })
            .eq("id", scheduleId);

          const timeStr = startTime.toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          });

          for (const uid of allParticipantIds) {
            if (uid === me.id) continue;
            await createNotification({
              userId: uid,
              type: "meetup_confirmed",
              title: `${schedule.event_title} is confirmed! 🎉`,
              body: `Everyone voted — you're going on ${timeStr}`,
              relatedUserId: me.id,
              relatedId: meetup.id,
            });
          }

          // Auto-add to participants' calendars
          const meetupData = {
            id: meetup.id,
            title: schedule.event_title,
            location: schedule.event_venue || undefined,
            start_time: startTime.toISOString(),
            end_time: endTime.toISOString(),
            status: "confirmed",
          };
          for (const uid of allParticipantIds) {
            const { data: pUser } = await getSupabase()
              .from("users")
              .select("firebase_uid")
              .eq("id", uid)
              .maybeSingle();
            if (pUser?.firebase_uid) {
              autoAddToCalendar(pUser.firebase_uid, meetupData).catch(() => {});
            }
          }
        }
      } else {
        await createNotification({
          userId: schedule.created_by,
          type: "meetup_request",
          title: "Everyone's voted!",
          body: `All friends voted on ${schedule.event_title} — pick a showtime!`,
          relatedUserId: me.id,
          relatedId: schedule.id,
        });
      }
    }

    res.json({ success: true, allVotesIn: allFriendsVoted });
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

    const frontendUrl = process.env.FRONTEND_URL || "https://slotted-ai.web.app";
    res.json({
      inviteId: invite.id,
      inviteUrl: `${frontendUrl}/invite/${token}`,
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
      .is("accepted_by", null)
      .maybeSingle();

    if (error || !invite) {
      res.status(404).json({ valid: false, error: "Invite not found or already used" });
      return;
    }

    // Check expiry
    if (new Date(invite.expires_at) < new Date()) {
      res.json({ valid: false, error: "This invite has expired" });
      return;
    }

    // Fetch inviter name
    const { data: inviter } = await getSupabase()
      .from("users")
      .select("display_name")
      .eq("id", invite.inviter_id)
      .maybeSingle();

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

    if (invite.accepted_by) {
      res.status(409).json({ error: "Invite already accepted" });
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

    // Mark invite as accepted
    const { error: updateErr } = await getSupabase()
      .from("friend_invites")
      .update({ accepted_by: me.id, accepted_at: new Date().toISOString() })
      .eq("id", invite.id);

    if (updateErr) { res.status(500).json({ error: updateErr.message }); return; }

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

    // Notify inviter
    await createNotification({
      userId: invite.inviter_id,
      type: "friend_accepted",
      title: "Your invite was accepted!",
      body: `${me.display_name?.split(" ")[0] || "Someone"} joined your ${invite.event_title} group via your invite link.`,
      relatedUserId: me.id,
      relatedId: invite.id,
    });

    // Trigger calendar sync for the new member
    try { await syncUserCalendar(req.uid!); } catch (err) { console.error("Calendar sync failed:", err); }

    res.json({
      success: true,
      eventTitle: invite.event_title,
      eventScheduleId: invite.event_schedule_id || null,
      friendsCreated: uniqueTargets.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /event-invite-meta/:token — serves HTML with OG meta tags for link previews */
router.get("/event-invite-meta/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;

    const { data: invite } = await getSupabase()
      .from("friend_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();

    const title = invite?.event_title || "You're invited to an event on Slotted";
    const description = invite?.event_venue
      ? `${invite.event_title} at ${invite.event_venue} — pick the dates that work for you`
      : "Pick the dates that work for you on Slotted.ai";
    const imageUrl = invite?.event_image_url || "https://slotted-ai.web.app/icons/icon-512.png";
    const escTitle = title.replace(/"/g, "&quot;").replace(/</g, "&lt;");
    const escDesc = description.replace(/"/g, "&quot;").replace(/</g, "&lt;");

    res.setHeader("Content-Type", "text/html");
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta property="og:title" content="${escTitle}" />
  <meta property="og:description" content="${escDesc}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:url" content="https://slotted-ai.web.app/invite/${token}" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escTitle}" />
  <meta name="twitter:description" content="${escDesc}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta http-equiv="refresh" content="0;url=/invite/${token}">
  <title>${title.replace(/</g, "&lt;")}</title>
</head>
<body>
  <p>Redirecting to <a href="/invite/${token}">Slotted.ai</a>...</p>
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

type BatteryLevel = 'open' | 'ask_me' | 'recharging';

const batteryConfig: Record<BatteryLevel, { label: string; emoji: string; dot: string; activeBg: string; activeText: string; activeBorder: string; hoverBg: string }> = {
  open: {
    label: 'Open',
    emoji: '🟢',
    dot: 'bg-battery-open',
    activeBg: 'bg-gradient-to-r from-emerald-50 to-teal-50',
    activeText: 'text-emerald-700',
    activeBorder: 'border-emerald-200',
    hoverBg: 'hover:bg-emerald-50/50',
  },
  ask_me: {
    label: 'Ask Me',
    emoji: '🟡',
    dot: 'bg-battery-ask',
    activeBg: 'bg-gradient-to-r from-amber-50 to-yellow-50',
    activeText: 'text-amber-700',
    activeBorder: 'border-amber-200',
    hoverBg: 'hover:bg-amber-50/50',
  },
  recharging: {
    label: 'Recharging',
    emoji: '🔴',
    dot: 'bg-battery-recharging',
    activeBg: 'bg-gradient-to-r from-red-50 to-rose-50',
    activeText: 'text-red-700',
    activeBorder: 'border-red-200',
    hoverBg: 'hover:bg-red-50/50',
  },
};

interface SocialBatteryProps {
  level: BatteryLevel;
  onChange?: (level: BatteryLevel) => void;
  readonly?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export default function SocialBattery({
  level,
  onChange,
  readonly = false,
  size = 'md',
}: SocialBatteryProps) {
  const levels: BatteryLevel[] = ['open', 'ask_me', 'recharging'];
  const sizeClasses = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3.5 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  };

  if (readonly) {
    const config = batteryConfig[level];
    return (
      <span className={`inline-flex items-center gap-2 rounded-full border ${config.activeBorder} ${config.activeBg} ${sizeClasses[size]} font-medium ${config.activeText}`}>
        <span className={`h-2 w-2 rounded-full ${config.dot}`} />
        {config.label}
      </span>
    );
  }

  return (
    <div className="space-y-2">
      <div className="inline-flex gap-1 rounded-xl bg-gray-100/80 p-1 backdrop-blur-sm">
        {levels.map((l) => {
          const config = batteryConfig[l];
          const isActive = level === l;
          return (
            <button
              key={l}
              onClick={() => onChange?.(l)}
              className={`flex items-center gap-2 rounded-lg ${sizeClasses[size]} font-medium transition-all ${
                isActive
                  ? `${config.activeBg} ${config.activeText} shadow-sm ring-1 ring-inset ring-black/5`
                  : `text-gray-500 ${config.hoverBg}`
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${config.dot} ${!isActive && 'opacity-40'}`} />
              {config.label}
            </button>
          );
        })}
      </div>
      <p className="text-[11px] text-gray-500 leading-relaxed">
        {level === 'open' && '🟢 You\'re up for plans — friends can suggest hangouts anytime.'}
        {level === 'ask_me' && '🟡 Check your mood first — Slotted will still suggest times but you choose.'}
        {level === 'recharging' && '🔴 Taking a break — your free time won\'t be suggested to friends.'}
      </p>
    </div>
  );
}

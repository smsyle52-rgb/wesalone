"use client";

import { Mail, MessageCircle, PhoneCall } from "lucide-react";

export type ChannelKind = "whatsapp" | "instagram" | "messenger" | "telegram" | "calls" | "email" | "webchat";

const gradients: Record<ChannelKind, string> = {
  whatsapp: "from-[#20D466] via-[#10B957] to-[#057A3E]",
  instagram: "from-[#FEDA75] via-[#D62976] to-[#4F5BD5]",
  messenger: "from-[#2AA7FF] via-[#1478FF] to-[#7A4DFF]",
  telegram: "from-[#36C5F0] via-[#229ED9] to-[#0B6FE8]",
  calls: "from-[#1FB6A6] via-[#0B8EA3] to-[#1B3A5C]",
  email: "from-[#22C7D8] via-[#0B6FE8] to-[#1B3A5C]",
  webchat: "from-[#38E6CE] via-[#1FB6A6] to-[#0B6FE8]",
};

export function ChannelIcon({
  kind,
  className = "",
  iconClassName = "h-6 w-6",
}: {
  kind: ChannelKind;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <span
      className={`channel-orb inline-grid place-items-center rounded-full bg-gradient-to-br ${gradients[kind]} text-white ${className}`}
      aria-hidden="true"
    >
      <InnerIcon kind={kind} className={iconClassName} />
    </span>
  );
}

function InnerIcon({ kind, className }: { kind: ChannelKind; className: string }) {
  if (kind === "calls") return <PhoneCall className={className} strokeWidth={2.4} />;
  if (kind === "email") return <Mail className={className} strokeWidth={2.4} />;
  if (kind === "webchat") return <MessageCircle className={className} strokeWidth={2.4} />;

  if (kind === "whatsapp") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 3.1a8.8 8.8 0 0 0-7.5 13.4L3.4 20.8l4.4-1.1A8.8 8.8 0 1 0 12 3.1Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path
          d="M8.8 8.3c.2-.4.4-.5.7-.5h.5c.2 0 .4.1.5.4l.7 1.6c.1.3.1.5-.1.7l-.5.6c.8 1.4 1.9 2.5 3.3 3.2l.7-.7c.2-.2.5-.2.8-.1l1.5.7c.3.1.4.3.4.6v.4c0 .5-.3.9-.8 1.1-.7.3-1.8.1-3-.5-2.2-1-4.3-3.1-5.4-5.3-.6-1.1-.7-1.8-.3-2.2Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  if (kind === "instagram") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <rect x="5" y="5" width="14" height="14" rx="4" stroke="currentColor" strokeWidth="2" />
        <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="2" />
        <circle cx="16.2" cy="7.9" r="1" fill="currentColor" />
      </svg>
    );
  }

  if (kind === "messenger") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none">
        <path
          d="M12 4.2c-4.6 0-8.3 3.3-8.3 7.4 0 2.4 1.3 4.6 3.4 5.9v2.3l2.3-1.3c.8.2 1.7.4 2.6.4 4.6 0 8.3-3.3 8.3-7.4S16.6 4.2 12 4.2Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <path d="m7.7 12.6 2.8-2.9 2.7 2.1 3.1-2.9-2.8 4.6-2.8-2.1-3 1.2Z" fill="currentColor" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <path d="M20.5 4.4 3.6 11.1c-.9.4-.9 1.6.1 1.9l4.2 1.2 1.7 5.2c.3.9 1.5 1 1.9.2l2.3-3.4 4.4 3.2c.7.5 1.7.1 1.9-.8L22 5.9c.2-1-.6-1.8-1.5-1.5Z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="m8.1 14.1 8.6-5.4-6.8 7.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

import { cn } from "@/lib/utils";
import { statusLabels, priorityLabels } from "@/lib/utils";

const statusColors: Record<string, string> = {
  new: "bg-blue-100 text-blue-700",
  open: "bg-green-100 text-green-700",
  pending: "bg-yellow-100 text-yellow-700",
  snoozed: "bg-purple-100 text-purple-700",
  resolved: "bg-gray-100 text-gray-600",
  closed: "bg-gray-200 text-gray-500",
  in_progress: "bg-blue-100 text-blue-700",
  todo: "bg-gray-100 text-gray-600",
  done: "bg-green-100 text-green-700",
  cancelled: "bg-red-100 text-red-500",
  completed: "bg-emerald-100 text-emerald-700",
  draft: "bg-gray-100 text-gray-600",
  submitted: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
  active: "bg-green-100 text-green-700",
  paused: "bg-yellow-100 text-yellow-700",
  disabled: "bg-gray-200 text-gray-600",
  scheduled: "bg-purple-100 text-purple-700",
  sending: "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  confirmed: "bg-green-100 text-green-700",
  processing: "bg-blue-100 text-blue-600",
  shipped: "bg-indigo-100 text-indigo-700",
  delivered: "bg-emerald-100 text-emerald-700",
  refunded: "bg-orange-100 text-orange-600",
  rejected: "bg-red-100 text-red-600",
  qualified: "bg-teal-100 text-teal-700",
  proposal: "bg-blue-100 text-blue-600",
  negotiation: "bg-purple-100 text-purple-700",
  won: "bg-emerald-100 text-emerald-700",
  lost: "bg-red-100 text-red-600",
  unpaid: "bg-red-100 text-red-600",
  partial: "bg-yellow-100 text-yellow-700",
  paid: "bg-green-100 text-green-700",
  urgent: "bg-red-100 text-red-700",
  high: "bg-orange-100 text-orange-700",
  medium: "bg-yellow-100 text-yellow-600",
  low: "bg-blue-100 text-blue-600",
};

export function StatusBadge({ status, type = "status" }: { status: string; type?: "status" | "priority" }) {
  const label = type === "priority" ? priorityLabels[status] : statusLabels[status];
  const color = statusColors[status] ?? "bg-gray-100 text-gray-600";
  return (
    <span className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", color)}>
      {label ?? status}
    </span>
  );
}

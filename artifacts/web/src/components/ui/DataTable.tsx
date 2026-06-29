import { cn } from "@/lib/utils";

interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  isLoading?: boolean;
}

function readCell<T>(row: T, col: Column<T>) {
  return col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "-");
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = "لا توجد بيانات",
  isLoading,
}: DataTableProps<T>) {
  if (isLoading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
          <span className="animate-pulse">جار التحميل...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="grid gap-3 p-3 md:hidden">
        {data.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          data.map((row) => {
            const rowKey = keyExtractor(row);
            const titleColumn = columns[0];
            const detailColumns = columns.slice(1);

            return (
              <div
                key={rowKey}
                onClick={() => onRowClick?.(row)}
                role={onRowClick ? "button" : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                onKeyDown={(event) => {
                  if (!onRowClick) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onRowClick(row);
                  }
                }}
                className={cn(
                  "w-full rounded-xl border border-border bg-background p-3 text-start shadow-sm sm:p-4",
                  onRowClick && "cursor-pointer transition hover:border-primary/30 hover:bg-muted/40",
                )}
              >
                <div className="min-w-0 break-words text-sm font-extrabold text-foreground">{readCell(row, titleColumn)}</div>
                <div className="mt-3 grid gap-2 text-xs">
                  {detailColumns.map((col) => (
                    <div key={col.key} className="grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] items-start gap-3">
                      <span className="font-bold text-muted-foreground">{col.label}</span>
                      <span className="min-w-0 break-words text-end text-foreground [&_*]:max-w-full">
                        {readCell(row, col)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn("whitespace-nowrap px-4 py-3 text-start font-semibold text-muted-foreground", col.className)}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-sm text-muted-foreground">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              data.map((row) => (
                <tr
                  key={keyExtractor(row)}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    "border-b border-border/50 transition-colors last:border-0 hover:bg-muted/30",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn("px-4 py-3 text-start text-foreground", col.className)}>
                      {readCell(row, col)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

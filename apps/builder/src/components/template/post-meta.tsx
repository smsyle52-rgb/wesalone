import { Badge } from "@/components/ui/badge";

interface PostMetaProps {
  date: string;
  category: string;
  readingTime: string;
}

/** Byline row rendered at the top of each MDX blog post. */
export function PostMeta({ date, category, readingTime }: PostMetaProps) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
      <Badge className="bg-primary/15 text-primary hover:bg-primary/15">
        {category}
      </Badge>
      <time>{date}</time>
      <span aria-hidden>·</span>
      <span>{readingTime}</span>
    </div>
  );
}


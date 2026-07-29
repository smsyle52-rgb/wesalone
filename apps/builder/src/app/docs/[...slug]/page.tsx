import { DocArticlePage } from "@/features/public-website/docs-page"

export default async function DocsArticleRoute({
  params,
}: {
  params: Promise<{ slug: string[] }>
}) {
  const { slug } = await params
  return <DocArticlePage slug={slug.join("/")} />
}

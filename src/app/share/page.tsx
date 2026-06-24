import { ExternalShareViewer } from "@/components/external-share-viewer"

export const metadata = { title: "RAI PACS Paylaşım" }

export default async function ExternalShareQueryPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const query = await searchParams

  return <ExternalShareViewer token={query.token ?? ""} />
}

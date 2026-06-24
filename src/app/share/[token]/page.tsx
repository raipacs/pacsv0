import { ExternalShareViewer } from "@/components/external-share-viewer"

export const metadata = { title: "RAI PACS Paylaşım" }

export default async function ExternalSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return <ExternalShareViewer token={decodeURIComponent(token)} />
}

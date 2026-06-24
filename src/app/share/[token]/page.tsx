import { ExternalShareShell } from "@/components/external-share-shell"

export const metadata = { title: "RAI PACS Paylaşım" }

export default async function ExternalSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return <ExternalShareShell token={decodeURIComponent(token)} />
}

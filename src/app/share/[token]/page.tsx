import ExternalShareQueryPage from "@/app/share/page"

export const metadata = { title: "RAI PACS Paylaşım" }

export default async function ExternalSharePage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  return (
    <ExternalShareQueryPage
      searchParams={Promise.resolve({ token: decodeURIComponent(token) })}
    />
  )
}

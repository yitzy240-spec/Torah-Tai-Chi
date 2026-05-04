import { redirect } from 'next/navigation';

export default async function EditClipsRedirect(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  redirect(`/videos/${slug}#clips`);
}

// app/[slug]/page.tsx (Server Component)

import { redirect } from "next/navigation";

interface PageProps {
    params: Promise<{
        slug: string;
    }>;
}

export default async function Page(props: PageProps) {
    const { slug } = await props.params;
    return redirect(`/genre/${slug}/movie`);
}
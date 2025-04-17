// app/[slug]/page.tsx (Server Component)

import { redirect } from "next/navigation";

interface PageProps {
    params: {
        slug: string;
    };
}

export default async function Page(props: PageProps) {
    const { slug } = await props.params;
    return redirect(`/keyword/${slug}/movie`);
}

import { buttonVariants } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Helmet } from "react-helmet";
import { Link } from "react-router-dom";

const NotFound404 = () => {
    return (
        <>
        <Helmet>
            <title>404 Not Found | Cinemania</title>
        </Helmet>
        <div className="flex flex-col items-center justify-center h-full gap-8 m-auto w-96">
            <img src="/notfound404.svg" alt="" />
            <CardTitle className="text-5xl">Oops...</CardTitle>
            <h1>The page you're looking for doesn't exists</h1>
            <Link to={"/"} className={buttonVariants()}>Back to home</Link>
        </div>
        </>
    );
}

export default NotFound404;
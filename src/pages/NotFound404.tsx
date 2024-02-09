import { buttonVariants } from "@/components/ui/button";
import { Link } from "react-router-dom";

const NotFound404 = () => {
    return (
        <div className="flex flex-col gap-8">
            <h1>The page you're looking for doesn't exists</h1>
            <Link to={"/"} className={buttonVariants()}>Back to home</Link>
        </div>
    );
}

export default NotFound404;
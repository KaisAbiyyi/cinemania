import { Search } from "lucide-react";
import { FC } from "react";
import { Button } from "./ui/button";

const Navbar: FC = () => {
    return (
        <div className="flex justify-end gap-4 p-4 bg-background">
            <Button variant={"ghost"}><Search /></Button>
            <Button>SIGN IN</Button>
        </div>
    );
}

export default Navbar;
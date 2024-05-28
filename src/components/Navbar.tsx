import { Search } from "lucide-react";
import { FC } from "react";
import { Button } from "./ui/button";

const Navbar: FC = () => {
    return (
        <div className="flex justify-end p-4 bg-primary">
            <Button><Search /></Button>
            <Button>SIGN IN</Button>
        </div>
    );
}

export default Navbar;
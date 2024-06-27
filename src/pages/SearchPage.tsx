import { FC } from "react";
import { useSearchParams } from "react-router-dom";

const SearchPage: FC = () => {
    const [searchParams] = useSearchParams();
    const query = searchParams.get("query");

    // Implement your search logic here using the query parameter
    console.log("Search query: ", query);

    return (
        <div>
            <h1>Search Results</h1>
            <p>Query: {query}</p>
            {/* Display search results based on the query */}
        </div>
    );
}

export default SearchPage;

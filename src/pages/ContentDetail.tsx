import { useParams } from "react-router-dom";


const ContentDetail = () => {
    const { id } = useParams()
    const stplittedId = ((id as string).split("-"))[0]

    return (<h1>{stplittedId}</h1>);
}

export default ContentDetail;
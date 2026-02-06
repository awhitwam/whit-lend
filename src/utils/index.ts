export function createPageUrl(pageName: string) {
    // Split path and query string to only replace spaces in the path
    const [path, queryString] = pageName.split('?');
    const cleanPath = '/' + path.replace(/ /g, '-');

    // If there's a query string, encode it properly (spaces become %20)
    if (queryString) {
        return cleanPath + '?' + queryString;
    }
    return cleanPath;
}
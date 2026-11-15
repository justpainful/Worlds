// go.enterworlds.space was the first address of Worlds on the web. It now
// sends every request to app.enterworlds.space, keeping the path and query.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.hostname = "app.enterworlds.space";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  },
};

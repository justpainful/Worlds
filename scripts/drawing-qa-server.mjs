import {createServer} from 'vite';
// Separate QA origin: active development must not reload an in-flight capture.
const server=await createServer({server:{host:'127.0.0.1',port:1422,strictPort:true,hmr:false},clearScreen:false});
await server.listen();server.printUrls();

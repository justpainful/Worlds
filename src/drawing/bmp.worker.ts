import {encodeBmp} from "./bmp";
import type {Pixels} from "./pixels";
self.onmessage=(event:MessageEvent<Pixels>)=>{try{const result=encodeBmp(event.data);(self as unknown as {postMessage:(value:unknown,transfer:Transferable[])=>void}).postMessage({result},[result.buffer]);}catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}};

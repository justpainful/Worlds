import {validatePixels,type Pixels} from "./pixels";
/** Standard BITMAPINFOHEADER, 24-bit BGR, bottom-up rows padded to4 bytes.
 * The caller composites its explicit matte before encoding this opaque format. */
export function encodeBmp(image:Pixels):Uint8Array<ArrayBuffer>{
 validatePixels(image);const {width,height,data}=image,stride=Math.ceil(width*3/4)*4,length=54+stride*height,bytes=new Uint8Array(length),view=new DataView(bytes.buffer);
 bytes[0]=0x42;bytes[1]=0x4d;view.setUint32(2,length,true);view.setUint32(10,54,true);view.setUint32(14,40,true);view.setInt32(18,width,true);view.setInt32(22,height,true);view.setUint16(26,1,true);view.setUint16(28,24,true);view.setUint32(34,stride*height,true);view.setInt32(38,3780,true);view.setInt32(42,3780,true);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const source=(y*width+x)*4,target=54+(height-1-y)*stride+x*3;bytes[target]=data[source+2];bytes[target+1]=data[source+1];bytes[target+2]=data[source];}return bytes;
}

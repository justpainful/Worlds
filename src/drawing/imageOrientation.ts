/** Read only TIFF IFD0 Orientation from validated image-container metadata.
 * Original pixels/bytes remain with the browser codec; no manual rotation is
 * applied a second time. Invalid optional metadata is treated as unspecified. */
export function imageOrientation(bytes:Uint8Array,mime:string):number{
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),tag=(at:number)=>String.fromCharCode(...bytes.subarray(at,at+4));
  const exif=(start:number,length:number):number=>{
    if(start<0||length<8||start+length>bytes.length)return 1;
    if(tag(start)==="Exif"&&bytes[start+4]===0&&bytes[start+5]===0){start+=6;length-=6;}
    if(length<8)return 1;
    const end=start+length,little=bytes[start]===0x49&&bytes[start+1]===0x49;
    if(!little&&!(bytes[start]===0x4d&&bytes[start+1]===0x4d)||v.getUint16(start+2,little)!==42)return 1;
    const offset=v.getUint32(start+4,little),ifd=start+offset;if(offset<8||ifd+2>end)return 1;
    const count=v.getUint16(ifd,little);if(ifd+2+count*12+4>end)return 1;
    for(let i=0;i<count;i++){const at=ifd+2+i*12;if(v.getUint16(at,little)===0x0112&&v.getUint16(at+2,little)===3&&v.getUint32(at+4,little)===1){const orientation=v.getUint16(at+8,little);return orientation>=1&&orientation<=8?orientation:1;}}
    return 1;
  };
  if(mime==="image/jpeg"){
    for(let p=2;p+4<=bytes.length;){if(bytes[p++]!==0xff)return 1;while(bytes[p]===0xff)p++;const marker=bytes[p++];if(marker===0xda||marker===0xd9)return 1;if(marker===0x01||marker>=0xd0&&marker<=0xd7)continue;
      if(p+2>bytes.length)return 1;const length=v.getUint16(p);if(length<2||p+length>bytes.length)return 1;if(marker===0xe1&&tag(p+2)==="Exif")return exif(p+2,length-2);p+=length;
    }
  }else if(mime==="image/png"){
    for(let p=8;p+12<=bytes.length;){const length=v.getUint32(p);if(p+length+12>bytes.length)return 1;if(tag(p+4)==="eXIf")return exif(p+8,length);p+=length+12;}
  }else if(mime==="image/webp"){
    for(let p=12;p+8<=bytes.length;){const length=v.getUint32(p+4,true);if(p+length+8>bytes.length)return 1;if(tag(p)==="EXIF")return exif(p+8,length);p+=length+8+length%2;}
  }
  return 1;
}

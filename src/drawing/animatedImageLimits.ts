import {ImageHeaderError,type ImageHeader} from "./imageHeaders";
import {validatePixelDimensions} from "./pixels";
export const MAX_ANIMATION_FRAMES=1000,MAX_ANIMATION_PIXELS=256*1024*1024;
export function validateAnimation(header:ImageHeader,index=0){
  validatePixelDimensions(header.width,header.height);const count=header.frameCount;
  if(!Number.isSafeInteger(count)||!count||count<1||count>MAX_ANIMATION_FRAMES||header.width*header.height*count>MAX_ANIMATION_PIXELS)throw new ImageHeaderError("animation");
  if(!Number.isInteger(index)||index<0||index>=count)throw new RangeError("Invalid animation frame");
}

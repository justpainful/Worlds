import {applyPixelEffect,validatePixels,type Pixels,type PixelEffect} from './pixels';
/** Interpolate in premultiplied RGBA so masked blur cannot produce dark halos. */
export function applyMaskedEffect(image:Pixels,effect:PixelEffect,mask:Uint8ClampedArray):Pixels{
 validatePixels(image);if(mask.length!==image.width*image.height)throw Error('Effect mask dimensions do not match');if(mask.length>16*1024*1024)throw Error('The masked effect exceeds the working memory limit');
 const result=applyPixelEffect(image,effect),a=image.data,b=result.data;
 for(let i=0;i<mask.length;i++){const p=i*4,t=mask[i]/255,alpha=a[p+3]*(1-t)+b[p+3]*t;for(let k=0;k<3;k++)b[p+k]=alpha?(a[p+k]*a[p+3]*(1-t)+b[p+k]*b[p+3]*t)/alpha:0;b[p+3]=alpha;}
 return result;
}

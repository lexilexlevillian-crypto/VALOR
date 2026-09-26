export const MEDIA_BYTES=256*1024;
export function mediaBytes(mime:string,encoded:string){
 if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))throw new Error('invalid_media_encoding');
 const bytes=Buffer.from(encoded,'base64');if(!bytes.length||bytes.length>MEDIA_BYTES)throw new Error('media_size_limit');
 const png=mime==='image/png'&&bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR';
 const jpeg=mime==='image/jpeg'&&bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 const webp=mime==='image/webp'&&bytes.length>=16&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
 if(!png&&!jpeg&&!webp)throw new Error('unsupported_media_content');
 if(png&&(bytes.readUInt32BE(16)>8192||bytes.readUInt32BE(20)>8192||bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16777216))throw new Error('media_dimensions_limit');
 return bytes;
}

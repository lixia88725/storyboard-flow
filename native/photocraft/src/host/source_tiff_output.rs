//! Metadata-only copy-on-write TIFF output. Pixel, Photoshop and unknown blocks
//! retain their original offsets and bytes; only the first-IFD header pointer changes.
use super::*;
fn refuse(message: &str) -> Error { Error::none("unsupported-source-tiff-output",message) }
fn u16_at(b:&[u8],at:usize,le:bool)->Result<u16>{let a=b.get(at..at+2).ok_or_else(||refuse("truncated TIFF"))?;Ok(if le{u16::from_le_bytes([a[0],a[1]])}else{u16::from_be_bytes([a[0],a[1]])})}
fn u32_at(b:&[u8],at:usize,le:bool)->Result<u32>{let a=b.get(at..at+4).ok_or_else(||refuse("truncated TIFF"))?;Ok(if le{u32::from_le_bytes(a.try_into().unwrap())}else{u32::from_be_bytes(a.try_into().unwrap())})}
fn put16(b:&mut Vec<u8>,n:u16,le:bool){b.extend_from_slice(&if le{n.to_le_bytes()}else{n.to_be_bytes()});}
fn put32(b:&mut Vec<u8>,n:u32,le:bool){b.extend_from_slice(&if le{n.to_le_bytes()}else{n.to_be_bytes()});}
pub(super) fn output(source:&[u8],metadata:&[u8],reference:&output_metadata::MetadataRef,max:usize)->Result<Vec<u8>>{
 output_metadata::validate(metadata,reference)?;
 let le=match source.get(..4){Some(b"II\x2a\0")=>true,Some(b"MM\0\x2a")=>false,_=>return Err(refuse("only classic TIFF supports metadata-only output"))};
 let offset=u32_at(source,4,le)? as usize;if offset<8{return Err(refuse("invalid first TIFF IFD offset"));}
 let count=u16_at(source,offset,le)? as usize;if count==0||count>4096{return Err(refuse("unsupported TIFF entry count"));}
 let end=offset+2+count*12;source.get(..end+4).ok_or_else(||refuse("truncated TIFF IFD"))?;
 let mut entries=Vec::new();let mut xmp=None;let mut width=false;let mut height=false;let mut tags=std::collections::HashSet::new();
 for i in 0..count{let at=offset+2+i*12;let tag=u16_at(source,at,le)?;if !tags.insert(tag){return Err(refuse("duplicate TIFF tag"));}
  let ty=u16_at(source,at+2,le)?;let n=u32_at(source,at+4,le)? as usize;
  let size=match ty{1|2|6|7=>1,3|8=>2,4|9|11|13=>4,5|10|12|16|17|18=>8,_=>return Err(refuse("unknown TIFF type"))};
  let length=n.checked_mul(size).ok_or_else(||refuse("TIFF entry length overflow"))?;
  let data=if length<=4{at+8}else{u32_at(source,at+8,le)? as usize};source.get(data..data.checked_add(length).ok_or_else(||refuse("TIFF offset overflow"))?).ok_or_else(||refuse("TIFF entry outside source"))?;
  if tag==256{width=true;}if tag==257{height=true;}
  if tag==700{if !matches!(ty,1|7)||length>source_metadata::MAX_XMP{return Err(refuse("unsupported XMP tag"));}xmp=Some(std::str::from_utf8(&source[data..data+length]).map_err(|_|refuse("XMP is not UTF-8"))?);}else{entries.push((tag,source[at..at+12].to_vec()));}
 }
 if !width||!height{return Err(refuse("TIFF lacks image dimensions"));}
 let xmp=output_metadata::merge_xmp(xmp,metadata)?;
 let mut out=source.to_vec();if out.len()%2!=0{out.push(0);}let xmp_offset=out.len();out.extend_from_slice(xmp.as_bytes());if out.len()%2!=0{out.push(0);}let ifd_offset=out.len();
 let mut entry=Vec::new();put16(&mut entry,700,le);put16(&mut entry,1,le);put32(&mut entry,xmp.len() as u32,le);put32(&mut entry,xmp_offset as u32,le);entries.push((700,entry));entries.sort_by_key(|e|e.0);
 put16(&mut out,entries.len() as u16,le);for(_,entry)in entries{out.extend_from_slice(&entry);}out.extend_from_slice(&source[end..end+4]);
 if out.len()>max||out.len()>u32::MAX as usize{return Err(refuse("metadata-only TIFF exceeds output budget"));}
 let pointer=if le{(ifd_offset as u32).to_le_bytes()}else{(ifd_offset as u32).to_be_bytes()};out[4..8].copy_from_slice(&pointer);Ok(out)
}
#[cfg(test)]mod tests{
 use super::*;
 fn envelope()->Vec<u8>{serde_json::to_vec(&json!({"schema":"flow.native-output-metadata","version":2,"projectId":"p","revision":1,"shotId":"s","imageId":"i","metadata":{"projectName":"p","shotName":"s","scriptText":"<&>","dialogues":[],"presentation":null}})).unwrap()}
 fn sample(le:bool)->Vec<u8>{let mut b=if le{b"II\x2a\0".to_vec()}else{b"MM\0\x2a".to_vec()};put32(&mut b,8,le);put16(&mut b,3,le);for tag in [256,257,65000]{put16(&mut b,tag,le);put16(&mut b,4,le);put32(&mut b,1,le);put32(&mut b,if tag==65000{0xfedcba98}else{1},le);}put32(&mut b,0,le);b.extend_from_slice(b"opaque Photoshop layers and pixels");b}
 #[test]fn preserves_all_bytes_except_header_pointer_and_supports_repeated_overlay(){for le in [true,false]{let b=sample(le);let m=envelope();let r=output_metadata::MetadataRef{sha256:sha(&m),byte_length:m.len()};let out=output(&b,&m,&r,1<<20).unwrap();assert_eq!(&out[..4],&b[..4]);assert_eq!(&out[8..b.len()],&b[8..]);let again=output(&out,&m,&r,1<<20).unwrap();assert_eq!(&again[8..out.len()],&out[8..]);let at=u32_at(&again,4,le).unwrap() as usize;assert_eq!(u16_at(&again,at,le).unwrap(),4);}}
 #[test]fn refuses_bad_inputs_without_a_decode(){let m=envelope();let r=output_metadata::MetadataRef{sha256:sha(&m),byte_length:m.len()};assert!(output(b"not tiff",&m,&r,100).is_err());let mut b=sample(true);b[4..8].copy_from_slice(&u32::MAX.to_le_bytes());assert!(output(&b,&m,&r,1<<20).is_err());assert!(output(&sample(true),&m,&r,8).is_err());}
}

//! Synthetic sources only. No personal-media paths or network are accepted.
use std::{fs, path::Path, sync::Arc};
use photocraft_codecs::{ChannelLayout, Format, Image};
use photocraft_doc::Layer;
fn main() -> Result<(),Box<dyn std::error::Error>> {
 let dir=std::env::args().nth(1).ok_or("Expected an owned fixture directory")?;
 let root=Path::new(&dir);if !root.is_dir(){return Err("Fixture directory must already exist".into());}
 let make=|rgba:[u8;4]| -> Result<_,Box<dyn std::error::Error>> {
  let img=Image::from_u8(4,2,ChannelLayout::Rgba,rgba.repeat(8))?;
  Ok(photocraft_codecs::encode(&img,Format::Png,&Default::default())?)
 };
 let mut doc=photocraft_io::import("base.png",&make([40,80,160,255])?)?.document;
 doc.layers[0].name="底图".into();
 let mut top=photocraft_io::import("top.png",&make([200,100,50,128])?)?.document.layers.remove(0);top.name="叠画".into();
 doc.layers.push(top.clone());
 let simple=photocraft_io::export(&doc,"psd",&Default::default())?;
 fs::write(root.join("simple.psd"),&simple.bytes)?;
 let mut stale=photocraft_psd::PsdFile::from_bytes(&simple.bytes)?;
 let area=stale.header.width as usize*stale.header.height as usize;
 let mut merged=vec![0u8;area*stale.header.channels as usize];
 if stale.header.channels==4 {merged[area*3..].fill(255);}
 stale.image_data=photocraft_psd::ImageData::encode(photocraft_psd::Compression::Raw,&merged,&stale.header)?;
 fs::write(root.join("stale.psd"),stale.to_bytes()?)?;
 // A real PSD group and an unmodelled block must stay in the retained source.
 doc.layers.pop();
 let mut group=Layer::group("复杂组",vec![top]);
 group.psd_blocks.push((*b"zFlw",Arc::new(b"retained-unknown-source-block".to_vec())));
 doc.layers.push(group);
 for ext in ["psd","tiff"] {
  let out=photocraft_io::export(&doc,ext,&photocraft_io::ExportOptions {tiff_layers:true,read_linked_files:false,..Default::default()})?;
  fs::write(root.join(format!("complex.{ext}")),out.bytes)?;
 }
 // Tagged Display P3 tests the CMS path, with an independent lcms oracle.
 doc.layers.truncate(1);doc.icc_profile=Some(photocraft_cms::Builtin::DisplayP3.profile().to_bytes());
 let out=photocraft_io::export(&doc,"tiff",&Default::default())?;
 fs::write(root.join("p3.tiff"),out.bytes)?;
 Ok(())
}

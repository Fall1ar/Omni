use std::fs::File;
use std::io::Write;
use std::path::PathBuf;

fn crc32(bytes: &[u8]) -> u32 { let mut c=!0u32; for &b in bytes { c^=b as u32; for _ in 0..8 { c=(c>>1)^(0xedb8_8320&(0u32.wrapping_sub(c&1))); } } !c }
fn u16(out:&mut Vec<u8>, n:u16){out.extend(n.to_le_bytes())} fn u32(out:&mut Vec<u8>, n:u32){out.extend(n.to_le_bytes())}
pub fn create_plugin_template() -> Result<String,String> {
 let dir=std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_else(|_|PathBuf::from(".")).join("Downloads"); std::fs::create_dir_all(&dir).map_err(|e|e.to_string())?; let target=dir.join("omni-plugin-template.zip");
 let files=[("omni_plugin_template/manifest.json",r#"{"name":"my_plugin","display_name":"My Plugin","version":"0.1.0","description":"My Omni plugin","type":"service","entrypoint":"main.py","python":">=3.10","permissions":[],"auto_start":false,"idle_timeout_sec":300}"#),("omni_plugin_template/main.py",r#"from omni_sdk import OmniBridge
class MyPlugin(OmniBridge):
    def on_request(self, method, params):
        if method == "ping": return {"pong": True}
        raise ValueError(f"Unknown method: {method}")
if __name__ == "__main__": MyPlugin().run()
"#),("omni_plugin_template/README.html",r#"<!doctype html><meta charset="utf-8"><title>Omni Plugin Guide</title><h1>Create an Omni plugin</h1><ol><li>Rename the folder and set a unique name in manifest.json.</li><li>Implement methods in on_request(method, params).</li><li>Use self.log(level, text) for UI logs.</li><li>Import the folder through Plugin Hub.</li></ol>"#)];
 let mut body=Vec::new();let mut central=Vec::new();for (name,text) in files {let off=body.len()as u32;let d=text.as_bytes();let c=crc32(d);u32(&mut body,0x04034b50);u16(&mut body,20);u16(&mut body,0);u16(&mut body,0);u16(&mut body,0);u16(&mut body,0);u32(&mut body,c);u32(&mut body,d.len()as u32);u32(&mut body,d.len()as u32);u16(&mut body,name.len()as u16);u16(&mut body,0);body.extend(name.as_bytes());body.extend(d);u32(&mut central,0x02014b50);u16(&mut central,20);u16(&mut central,20);u16(&mut central,0);u16(&mut central,0);u16(&mut central,0);u16(&mut central,0);u32(&mut central,c);u32(&mut central,d.len()as u32);u32(&mut central,d.len()as u32);u16(&mut central,name.len()as u16);u16(&mut central,0);u16(&mut central,0);u16(&mut central,0);u16(&mut central,0);u32(&mut central,0);u32(&mut central,off);central.extend(name.as_bytes());}let off=body.len()as u32;let sz=central.len()as u32;body.extend(central);u32(&mut body,0x06054b50);u16(&mut body,0);u16(&mut body,0);u16(&mut body,files.len()as u16);u16(&mut body,files.len()as u16);u32(&mut body,sz);u32(&mut body,off);u16(&mut body,0);File::create(&target).and_then(|mut f|f.write_all(&body)).map_err(|e|e.to_string())?;Ok(target.display().to_string()) }

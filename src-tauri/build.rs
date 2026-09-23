fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=native/glass.m");
        cc::Build::new()
            .file("native/glass.m")
            .flag("-fobjc-arc")
            .flag("-fmodules")
            .compile("clonq_glass");
        println!("cargo:rustc-link-lib=framework=AppKit");
    }
    tauri_build::build()
}

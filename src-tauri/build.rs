fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        println!("cargo:rerun-if-changed=native/glass.m");
        cc::Build::new()
            .file("native/glass.m")
            .flag("-fobjc-arc")
            .flag("-fmodules")
            .compile("clonq_glass");
        println!("cargo:rustc-link-lib=framework=AppKit");
        link_clang_runtime();
    }
    tauri_build::build()
}

/// `@available(macOS 26.0, *)` in glass.m becomes a call to `__isPlatformVersionAtLeast`
/// when the app also runs on older systems. That function lives in clang's runtime
/// library, which rustc does not link by itself.
fn link_clang_runtime() {
    let output = std::process::Command::new("xcrun")
        .args(["clang", "--print-runtime-dir"])
        .output()
        .expect("xcrun clang --print-runtime-dir");
    let dir = String::from_utf8(output.stdout).expect("runtime dir is UTF-8");
    println!("cargo:rustc-link-search=native={}", dir.trim());
    println!("cargo:rustc-link-lib=static=clang_rt.osx");
}

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
    release_date();
    tauri_build::build()
}

/// The release day, which licences are compared against (updates covered until a date). The
/// release workflow sets CLONQ_RELEASE_DATE; a build script's output is cached between builds,
/// so the build day alone could stay at the day of the first build.
fn release_date() {
    println!("cargo:rerun-if-env-changed=CLONQ_RELEASE_DATE");
    let day = match std::env::var("CLONQ_RELEASE_DATE") {
        Ok(day) if !day.trim().is_empty() => day.trim().to_string(),
        _ => {
            let output = std::process::Command::new("date").args(["-u", "+%Y-%m-%d"]).output().expect("date");
            String::from_utf8_lossy(&output.stdout).trim().to_string()
        }
    };
    println!("cargo:rustc-env=CLONQ_RELEASED={day}");
    println!("cargo:rerun-if-env-changed=CLONQ_LICENCE_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=CLONQ_LICENCE_SERVICE");
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

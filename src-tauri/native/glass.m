#import <AppKit/AppKit.h>

// Puts Liquid Glass behind the web page. The page itself stays transparent, so
// what shows through is the glass, and through the glass the desktop.
//
// wry makes its own view the window's content view and hangs the WKWebView
// inside it; the glass goes into that same view, underneath the web view.
// Any glass from an earlier call is removed first, so calling twice does not
// stack two layers.
void clonq_apply_glass(void *ns_window, double corner_radius) {
  NSWindow *window = (__bridge NSWindow *)ns_window;
  if (window == nil) {
    return;
  }
  NSView *content = [window contentView];

  for (NSView *view in [[content subviews] copy]) {
    BOOL isGlass = [view isKindOfClass:[NSVisualEffectView class]];
    if (@available(macOS 26.0, *)) {
      isGlass = isGlass || [view isKindOfClass:[NSGlassEffectView class]];
    }
    if (isGlass) {
      [view removeFromSuperview];
    }
  }

  [window setOpaque:NO];
  [window setBackgroundColor:[NSColor clearColor]];

  NSView *backdrop = nil;
  if (@available(macOS 26.0, *)) {
    NSGlassEffectView *glass = [[NSGlassEffectView alloc] initWithFrame:[content bounds]];
    [glass setCornerRadius:corner_radius];
    [glass setStyle:NSGlassEffectViewStyleRegular];
    backdrop = glass;
  } else {
    NSVisualEffectView *frost = [[NSVisualEffectView alloc] initWithFrame:[content bounds]];
    [frost setMaterial:NSVisualEffectMaterialPopover];
    [frost setBlendingMode:NSVisualEffectBlendingModeBehindWindow];
    [frost setState:NSVisualEffectStateActive];
    backdrop = frost;
  }
  [backdrop setAutoresizingMask:NSViewWidthSizable | NSViewHeightSizable];
  [content addSubview:backdrop positioned:NSWindowBelow relativeTo:nil];

  // The web page gets the same rounded outline as the glass.
  if (corner_radius > 0) {
    [content setWantsLayer:YES];
    [[content layer] setCornerRadius:corner_radius];
    [[content layer] setMasksToBounds:YES];
  }
  [window invalidateShadow];
}

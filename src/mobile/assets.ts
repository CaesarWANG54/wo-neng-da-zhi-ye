import { publicAssetPath } from "../asset-path";

export const mobileAssets = {
  iphoneBezel: publicAssetPath("assets/iphone/Bezel.png"),
  iphoneKeyboard: publicAssetPath("assets/iphone/Keyboard.png"),
  androidKeyboard: publicAssetPath("assets/android/Keyboard.png"),
  pixel10Bezel: publicAssetPath("assets/android/Pixel10.png"),
  androidNavigation: publicAssetPath("assets/android/navigation-bar.svg"),
  androidStatusIcons: publicAssetPath("assets/status/status-icons.svg"),
  iosStatusIcons: publicAssetPath("assets/status/ios-status-icons.svg"),
} as const;

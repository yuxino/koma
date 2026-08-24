// 服务端错误消息是中文写死的，英文界面下原样展示会很突兀。
// 这里按消息特征做中→英映射；映射不到时退回通用文案，避免英文用户看到一整段中文。

type Language = "en" | "zh";

const translations: Array<[RegExp, string]> = [
  [/公开演示次数已经用完/, "Today's public demo allowance has been used. Try again tomorrow or configure your own model keys locally."],
  [/没有找到视频文件/, "No video file was found."],
  [/请放入视频文件/, "Please choose a video file."],
  [/视频太大了/, "Video is too large. Reduce the file size or pick a shorter video."],
  [/视频太长了/, "Video is too long. Pick a shorter video."],
  [/这个文件里没有视频画面/, "This file has no video track. Please choose a video with visuals."],
  [/请输入视频地址/, "Please enter a video URL."],
  [/只支持 http 或 https/, "Only http or https video URLs are supported."],
  [/不支持访问本机或内网地址/, "Local or private network addresses are not allowed."],
  [/返回的是网页|不是可直接下载的视频/, "This URL returned a web page instead of a downloadable video."],
  [/下载不完整|视频没有完整到达/, "Video download was incomplete. Try again or use a direct video URL."],
  [/视频地址无法访问/, "The video URL could not be accessed."],
  [/重定向次数太多/, "The link redirected too many times and could not be resolved."],
  [/解析到视频/, "No video could be resolved from this link."],
  [/没有从 B 站链接里找到视频编号/, "No video ID was found in this Bilibili link."],
  [/B 站视频信息获取失败/, "Bilibili could not provide the video information."],
  [/B 站播放地址获取失败/, "Bilibili could not provide a playable address."],
  [/没有可用的分P编号/, "This Bilibili video has no playable part."],
  [/听写任务超时/, "Transcription timed out. Please try again."],
  [/ASR_PROVIDER=.*缺少/, "The transcription provider configuration is incomplete."],
  [/VISION_PROVIDER=.*缺少/, "The vision provider configuration is incomplete."],
  [/听写任务失败|没有成功结果|听写任务提交失败/, "Transcription failed. Please try again."],
  [/听写任务没有返回任务编号/, "The transcription service did not return a task id."],
  [/听写结果下载失败/, "Could not download the transcription result. Please try again."],
  [/说话人分离需要配置 PUBLIC_BASE_URL/, "Speaker diarization needs a public service URL (PUBLIC_BASE_URL). Analysis continued without speaker labels."],
  [/音频无法下载/, "The audio file could not be downloaded by the transcription service."],
  [/画面模型没有返回有效 JSON/, "The vision model returned an invalid response. Please try again."],
  [/没有按要求返回结构化提取结果/, "The vision model did not return the requested structured data. Please try again."],
  [/结构化提取结果与期望 JSON 结构不匹配/, "The vision model returned data that does not match the expected JSON shape. Please try again."],
  [/自定义结构化提取需要配置真实的视觉模型/, "Custom extraction requires a configured vision model; mock mode only provides the general demo result."],
  [/自定义提取和文件产物需要配置真实的视觉模型/, "Custom extraction and generated files require a configured vision model; mock mode only provides the general demo result."],
  [/生成 JSON 配置需要先配置真实的视觉模型|视觉模型的 API Key、Base URL 或模型尚未配置完整/, "AI JSON creation requires a configured vision model."],
  [/生成 JSON 配置时模型请求失败|模型没有返回可用的 JSON 配置/, "Koma could not create a valid JSON shape. Please adjust the request and try again."],
  [/lang 只支持 en 或 zh/, "The interface language must be en or zh."],
  [/期望 JSON 结构不是有效 JSON/, "The expected JSON shape is not valid JSON."],
  [/期望 JSON 结构必须是对象或数组/, "The expected JSON shape must be an object or array."],
  [/分析要求最多/, "The analysis requirement is too long."],
  [/期望 JSON 结构最多|结构化提取结果超过/, "The expected JSON shape or extraction result is too large."],
  [/期望 JSON 结构过于复杂/, "The expected JSON shape is too deeply nested or contains too many fields."],
  [/不支持的输出文件格式|输出文件格式不是有效列表|输出文件格式必须是列表/, "The requested output file format is not supported."],
  [/产物文件|JSON 产物不是有效 JSON/, "The model could not generate the requested file correctly. Please try again or reduce the output."],
  [/画面模型请求失败/, "The vision model request failed. Please try again."],
  [/音频切片超过/, "An audio segment exceeds the size limit."],
  [/这次分析已经消失了/, "This analysis is no longer available."],
  [/这张抽帧已经消失了/, "This frame is no longer available."],
  [/这段视频已经消失了/, "This video is no longer available."],
  [/没有找到这个地址/, "This endpoint was not found."]
];

export function translateServerError(message: string | null | undefined, language: Language): string {
  const text = typeof message === "string" ? message.trim() : "";
  if (!text) return "";
  if (language === "zh") return text;
  for (const [pattern, english] of translations) {
    if (pattern.test(text)) return english;
  }
  return "Something went wrong. Please try again.";
}

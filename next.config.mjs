/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // The edit runs FFmpeg (installed by the ffmpeg-static package) on the server.
  // Next.js can't tell the edit needs that program, so it's added to the edit route by hand.
  outputFileTracingIncludes: {
    "/api/movies/*/edit-progress": ["./node_modules/ffmpeg-static/ffmpeg"],
    "/api/movies/\\[id\\]/edit-progress": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
};

export default nextConfig;

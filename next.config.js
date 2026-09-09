/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mongoose", "multer"],
  },
};

module.exports = nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: ["@trapit/auth", "@trapit/testing"],
};

export default nextConfig;
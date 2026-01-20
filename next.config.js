// next.config.js
/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config, { isServer }) => {
    // Fix for 'ws' and Google libraries during Vercel build
    if (!isServer) {
      config.resolve.alias.ws = false;
      config.resolve.alias['@google-cloud/common'] = false;
      config.resolve.alias['google-auth-library'] = false;
    }

    if (!config.externals) {
      config.externals = [];
    }
    config.externals.push('bufferutil', 'utf-8-validate');

    return config;
  },
  // Ignore ESLint errors during build
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Ignore TypeScript errors during build
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;

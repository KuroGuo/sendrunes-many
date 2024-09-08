const path = require('path')
const webpack = require('webpack')

module.exports = {
  entry: './libs.js',
  output: {
    filename: 'libs.js',
    path: path.resolve(__dirname, 'dist')
  },
  mode: 'production',
  experiments: {
    asyncWebAssembly: true
  },
  resolve: {
    fallback: {
      buffer: require.resolve('buffer/')
    }
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/
      },
      {
        test: /\.wasm$/,
        type: 'webassembly/async'
      }
    ]
  },
  plugins: [
    new webpack.ProvidePlugin({
      Buffer: ['buffer', 'Buffer']
    }),
    new webpack.DefinePlugin({
      'process.env.BITRUNE_ENV': JSON.stringify(process.env.BITRUNE_ENV)
    })
  ]
}
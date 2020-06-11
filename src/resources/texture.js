Object.assign(pc, function () {
    'use strict';

    var JSON_ADDRESS_MODE = {
        "repeat": pc.ADDRESS_REPEAT,
        "clamp": pc.ADDRESS_CLAMP_TO_EDGE,
        "mirror": pc.ADDRESS_MIRRORED_REPEAT
    };

    var JSON_FILTER_MODE = {
        "nearest": pc.FILTER_NEAREST,
        "linear": pc.FILTER_LINEAR,
        "nearest_mip_nearest": pc.FILTER_NEAREST_MIPMAP_NEAREST,
        "linear_mip_nearest": pc.FILTER_LINEAR_MIPMAP_NEAREST,
        "nearest_mip_linear": pc.FILTER_NEAREST_MIPMAP_LINEAR,
        "linear_mip_linear": pc.FILTER_LINEAR_MIPMAP_LINEAR
    };

    var JSON_TEXTURE_TYPE = {
        "default": pc.TEXTURETYPE_DEFAULT,
        "rgbm": pc.TEXTURETYPE_RGBM,
        "rgbe": pc.TEXTURETYPE_RGBE,
        "swizzleGGGR": pc.TEXTURETYPE_SWIZZLEGGGR
    };

    /**
     * @interface
     * @name pc.TextureParser
     * @description Interface to a texture parser. Implementations of this interface handle the loading
     * and opening of texture assets.
     */
    var TextureParser = function () { };

    Object.assign(TextureParser.prototype, {
        /**
         * @function
         * @name pc.TextureParser#load
         * @description Load the texture from the remote URL. When loaded (or failed),
         * use the callback to return an the raw resource data (or error).
         * @param {object} url - The URL of the resource to load.
         * @param {string} url.load - The URL to use for loading the resource
         * @param {string} url.original - The original URL useful for identifying the resource type
         * @param {pc.callbacks.ResourceHandler} callback - The callback used when the resource is loaded or an error occurs.
         * @param {pc.Asset} [asset] - Optional asset that is passed by ResourceLoader.
         */
        /* eslint-disable jsdoc/require-returns-check */
        load: function (url, callback, asset) {
            throw new Error('not implemented');
        },
        /* eslint-enable jsdoc/require-returns-check */

        /**
         * @function
         * @name pc.TextureParser#open
         * @description Convert raw resource data into a resource instance. E.g. Take 3D model format JSON and return a pc.Model.
         * @param {string} url - The URL of the resource to open.
         * @param {*} data - The raw resource data passed by callback from {@link pc.ResourceHandler#load}.
         * @param {pc.Asset|null} asset - Optional asset which is passed in by ResourceLoader.
         * @param {pc.GraphicsDevice} device - The graphics device
         * @returns {pc.Texture} The parsed resource data.
         */
        /* eslint-disable jsdoc/require-returns-check */
        open: function (url, data, device) {
            throw new Error('not implemented');
        }
        /* eslint-enable jsdoc/require-returns-check */
    });

    // In the case where a texture has more than 1 level of mip data specified, but not the full
    // mip chain, we generate the missing levels here.
    // This is to overcome an issue where iphone xr and xs ignores further updates to the mip data
    // after invoking gl.generateMipmap on the texture (which was the previous method of ensuring
    // the texture's full mip chain was complete).
    // NOTE: this function only resamples RGBA8 and RGBAFloat32 data.
    var _completePartialMipmapChain = function (texture) {

        var requiredMipLevels = Math.log2(Math.max(texture._width, texture._height)) + 1;

        var isHtmlElement = function (object) {
            return (object instanceof HTMLCanvasElement) ||
                   (object instanceof HTMLImageElement) ||
                   (object instanceof HTMLVideoElement);
        };

        if (!(texture._format === pc.PIXELFORMAT_R8_G8_B8_A8 ||
              texture._format === pc.PIXELFORMAT_RGBA32F) ||
              texture._volume ||
              texture._compressed ||
              texture._levels.length === 1 ||
              texture._levels.length === requiredMipLevels ||
              isHtmlElement(texture._cubemap ? texture._levels[0][0] : texture._levels[0])) {
            return;
        }

        var downsample = function (width, height, data) {
            var sampledWidth = Math.max(1, width >> 1);
            var sampledHeight = Math.max(1, height >> 1);
            var sampledData = new data.constructor(sampledWidth * sampledHeight * 4);

            var xs = Math.floor(width / sampledWidth);
            var ys = Math.floor(height / sampledHeight);
            var xsys = xs * ys;

            for (var y = 0; y < sampledHeight; ++y) {
                for (var x = 0; x < sampledWidth; ++x) {
                    for (var e = 0; e < 4; ++e) {
                        var sum = 0;
                        for (var sy = 0; sy < ys; ++sy) {
                            for (var sx = 0; sx < xs; ++sx) {
                                sum += data[(x * xs + sx + (y * ys + sy) * width) * 4 + e];
                            }
                        }
                        sampledData[(x + y * sampledWidth) * 4 + e] = sum / xsys;
                    }
                }
            }

            return sampledData;
        };

        // step through levels
        for (var level = texture._levels.length; level < requiredMipLevels; ++level) {
            var width = Math.max(1, texture._width >> (level - 1));
            var height = Math.max(1, texture._height >> (level - 1));
            if (texture._cubemap) {
                var mips = [];
                for (var face = 0; face < 6; ++face) {
                    mips.push(downsample(width, height, texture._levels[level - 1][face]));
                }
                texture._levels.push(mips);
            } else {
                texture._levels.push(downsample(width, height, texture._levels[level - 1]));
            }
        }

        texture._levelsUpdated = texture._cubemap ? [[true, true, true, true, true, true]] : [true];
    };

    /**
     * @class
     * @name pc.TextureHandlerOptions
     * @description The supported {@link pc.Asset} options when loading texture assets.
     * @property {boolean} [crossOrigin] - For browser-supported image formats only, enable cross origin.
     */

    /**
     * @class
     * @name pc.TextureHandler
     * @implements {pc.ResourceHandler}
     * @classdesc Resource handler used for loading 2D and 3D {@link pc.Texture} resources.
     * @param {pc.GraphicsDevice} device - The graphics device.
     * @param {pc.AssetRegistry} assets - The asset registry.
     * @param {pc.ResourceLoader} loader - The resource loader.
     */
    var TextureHandler = function (device, assets, loader) {
        this._device = device;
        this._assets = assets;
        this._loader = loader;

        // img parser handles all broswer-supported image formats, this
        // parser will be used when other more specific parsers are not found.
        this.imgParser = new pc.ImgParser(assets, false);

        this.parsers = {
            dds: new pc.LegacyDdsParser(assets, false),
            ktx: new pc.KtxParser(assets, false),
            basis: new pc.BasisParser(assets, false)
        };
    };

    Object.assign(TextureHandler.prototype, {
        _getUrlWithoutParams: function (url) {
            return url.indexOf('?') >= 0 ? url.split('?')[0] : url;
        },

        _getParser: function (url) {
            var ext = pc.path.getExtension(this._getUrlWithoutParams(url)).toLowerCase().replace('.', '');
            return this.parsers[ext] || this.imgParser;
        },

        load: function (url, callback, asset) {
            if (typeof url === 'string') {
                url = {
                    load: url,
                    original: url
                };
            }

            this._getParser(url.original).load(url, callback, asset);
        },

        open: function (url, data, asset) {
            if (!url)
                return;

            var texture = this._getParser(url).open(url, data, this._device);

            if (texture === null) {
                texture = new pc.Texture(this._device, {
                    width: 4,
                    height: 4,
                    format: pc.PIXELFORMAT_R8_G8_B8
                });
            } else {
                // check if the texture has only a partial mipmap chain specified and generate the
                // missing levels if possible.
                _completePartialMipmapChain(texture);
            }

            return texture;
        },

        patch: function (asset, assets) {
            var texture = asset.resource;
            if (!texture) {
                return;
            }

            if (asset.name && asset.name.length > 0) {
                texture.name = asset.name;
            }

            var assetData = asset.data;

            if (assetData.hasOwnProperty('minfilter')) {
                texture.minFilter = JSON_FILTER_MODE[assetData.minfilter];
            }

            if (assetData.hasOwnProperty('magfilter')) {
                texture.magFilter = JSON_FILTER_MODE[assetData.magfilter];
            }

            if (!texture.cubemap) {
                if (assetData.hasOwnProperty('addressu')) {
                    texture.addressU = JSON_ADDRESS_MODE[assetData.addressu];
                }

                if (assetData.hasOwnProperty('addressv')) {
                    texture.addressV = JSON_ADDRESS_MODE[assetData.addressv];
                }
            }

            if (assetData.hasOwnProperty('mipmaps')) {
                texture.mipmaps = assetData.mipmaps;
            }

            if (assetData.hasOwnProperty('anisotropy')) {
                texture.anisotropy = assetData.anisotropy;
            }

            if (assetData.hasOwnProperty('flipY')) {
                texture.flipY = !!assetData.flipY;
            }

            // extract asset type (this is bit of a mess)
            if (assetData.hasOwnProperty('type')) {
                texture.type = JSON_TEXTURE_TYPE[assetData.type];
            } else if (assetData.hasOwnProperty('rgbm') && assetData.rgbm) {
                texture.type = pc.TEXTURETYPE_RGBM;
            } else if (asset.file && asset.getPreferredFile) {
                // basis normalmaps flag the variant as swizzled
                var preferredFile = asset.getPreferredFile();
                if (preferredFile) {
                    if (preferredFile.opt && ((preferredFile.opt & 8) !== 0)) {
                        texture.type = pc.TEXTURETYPE_SWIZZLEGGGR;
                    }
                }
            }
        }
    });

    return {
        TextureHandler: TextureHandler,
        TextureParser: TextureParser
    };
}());

import { LAYERID_WORLD } from '../../../scene/constants.js';
import { BatchGroup } from '../../../scene/batching.js';
import { MeshInstance } from '../../../scene/mesh-instance.js';
import { getShapePrimitive } from '../../../scene/procedural.js';

import { Component } from '../component.js';

/**
 * @private
 * @component
 * @class
 * @name pc.RenderComponent
 * @augments pc.Component
 * @classdesc Enables an Entity to render a {@link pc.Mesh} or a primitive shape. This component attaches {@link pc.MeshInstance} geometry to the Entity.
 * @description Create a new RenderComponent.
 * @param {pc.RenderComponentSystem} system - The ComponentSystem that created this Component.
 * @param {pc.Entity} entity - The Entity that this Component is attached to.
 * @property {string} type The type of the model. Can be one of the following:
 * * "asset": The component will render a model asset
 * * "box": The component will render a box (1 unit in each dimension)
 * * "capsule": The component will render a capsule (radius 0.5, height 2)
 * * "cone": The component will render a cone (radius 0.5, height 1)
 * * "cylinder": The component will render a cylinder (radius 0.5, height 1)
 * * "plane": The component will render a plane (1 unit in each dimension)
 * * "sphere": The component will render a sphere (radius 0.5)
 * @property {boolean} castShadows If true, attached meshes will cast shadows for lights that have shadow casting enabled.
 * @property {boolean} receiveShadows If true, shadows will be cast on attached meshes.
 * @property {pc.Material} material The material {@link pc.Material} that will be used to render the meshes (not used on models of type 'asset').
 * @property {boolean} castShadowsLightmap If true, the meshes will cast shadows when rendering lightmaps.
 * @property {boolean} lightmapped If true, the meshes will be lightmapped after using lightmapper.bake().
 * @property {number} lightmapSizeMultiplier Lightmap resolution multiplier.
 * @property {boolean} isStatic Mark meshes as non-movable (optimization).
 * @property {pc.MeshInstance[]} meshInstances An array of meshInstances contained in the component. If meshes are not set or loaded for component it will return null.
 * @property {number} batchGroupId Assign meshes to a specific batch group (see {@link pc.BatchGroup}). Default value is -1 (no group).
 * @property {number[]} layers An array of layer IDs ({@link pc.Layer#id}) to which the meshes should belong.
 * Don't push/pop/splice or modify this array, if you want to change it - set a new one instead.
 */
function RenderComponent(system, entity)   {
    Component.call(this, system, entity);

    this._type = 'asset';
    this._castShadows = true;
    this._receiveShadows = true;
    this._castShadowsLightmap = true;
    this._lightmapped = false;
    this._lightmapSizeMultiplier = 1;
    this._isStatic = false;
    this._batchGroupId = -1;

    this._meshInstances = [];
    this._layers = [LAYERID_WORLD]; // assign to the default world layer

    this._material = system.defaultMaterial;
    this._materialEvents = null;

    // area - used by lightmapper
    this._area = null;

    entity.on('remove', this.onRemoveChild, this);
    entity.on('insert', this.onInsertChild, this);
}
RenderComponent.prototype = Object.create(Component.prototype);
RenderComponent.prototype.constructor = RenderComponent;

Object.assign(RenderComponent.prototype, {

    addToLayers: function () {
        var layer, layers = this.system.app.scene.layers;
        for (var i = 0; i < this._layers.length; i++) {
            layer = layers.getLayerById(this._layers[i]);
            if (layer) {
                layer.addMeshInstances(this._meshInstances);
            }
        }
    },

    removeFromLayers: function () {

        var layer, layers = this.system.app.scene.layers;
        for (var i = 0; i < this._layers.length; i++) {
            layer = layers.getLayerById(this._layers[i]);
            if (layer) {
                layer.removeMeshInstances(this._meshInstances);
            }
        }
    },

    onRemoveChild: function () {
        if (this._meshInstances) {
            this.removeFromLayers();
        }
    },

    onInsertChild: function () {
        if (this._meshInstances && this.enabled && this.entity.enabled) {
            this.addToLayers();
        }
    },

    onRemove: function () {
        this._unsetMaterialEvents();

        this.entity.off('remove', this.onRemoveChild, this);
        this.entity.off('insert', this.onInsertChild, this);
    },

    onLayersChanged: function (oldComp, newComp) {
        this.addToLayers();
        oldComp.off("add", this.onLayerAdded, this);
        oldComp.off("remove", this.onLayerRemoved, this);
        newComp.on("add", this.onLayerAdded, this);
        newComp.on("remove", this.onLayerRemoved, this);
    },

    onLayerAdded: function (layer) {
        var index = this.layers.indexOf(layer.id);
        if (index < 0) return;
        layer.addMeshInstances(this._meshInstances);
    },

    onLayerRemoved: function (layer) {
        var index = this.layers.indexOf(layer.id);
        if (index < 0) return;
        layer.removeMeshInstances(this._meshInstances);
    },

    _setMaterialEvent: function (index, event, id, handler) {
        var evt = event + ':' + id;
        this.system.app.assets.on(evt, handler, this);

        if (!this._materialEvents)
            this._materialEvents = [];

        if (!this._materialEvents[index])
            this._materialEvents[index] = { };

        this._materialEvents[index][evt] = {
            id: id,
            handler: handler
        };
    },

    _unsetMaterialEvents: function () {
        var events = this._materialEvents;
        if (events) {

            var assets = this.system.app.assets;
            for (var i = 0, len = events.length; i < len; i++) {
                var evt = events[i];
                if (evt) {
                    for (var key in evt) {
                        assets.off(key, evt[key].handler, this);
                    }
                }
            }

            this._materialEvents = null;
        }
    },

    onEnable: function () {
        var app = this.system.app;
        var scene = app.scene;

        scene.on("set:layers", this.onLayersChanged, this);
        if (scene.layers) {
            scene.layers.on("add", this.onLayerAdded, this);
            scene.layers.on("remove", this.onLayerRemoved, this);
        }

        if (this._meshInstances) {
            this.addToLayers();
        }

        if (this._batchGroupId >= 0) {
            app.batcher.insert(BatchGroup.RENDER, this.batchGroupId, this.entity);
        }
    },

    onDisable: function () {
        var app = this.system.app;
        var scene = app.scene;

        scene.off("set:layers", this.onLayersChanged, this);
        if (scene.layers) {
            scene.layers.off("add", this.onLayerAdded, this);
            scene.layers.off("remove", this.onLayerRemoved, this);
        }

        if (this._batchGroupId >= 0) {
            app.batcher.remove(BatchGroup.RENDER, this.batchGroupId, this.entity);
        }

        if (this._meshInstances) {
            this.removeFromLayers();
        }
    },

    /**
     * @private
     * @function
     * @name pc.RenderComponent#hide
     * @description Stop rendering {@link pc.MeshInstance}s without removing them from the scene hierarchy.
     * This method sets the {@link pc.MeshInstance#visible} property of every MeshInstance to false.
     * Note, this does not remove the mesh instances from the scene hierarchy or draw call list.
     * So the model component still incurs some CPU overhead.
     */
    hide: function () {
        if (this._meshInstances) {
            for (var i = 0; i < this._meshInstances.length; i++) {
                this._meshInstances[i].visible = false;
            }
        }
    },

    /**
     * @private
     * @function
     * @name pc.RenderComponent#show
     * @description Enable rendering of the model {@link pc.MeshInstance}s if hidden using {@link pc.RenderComponent#hide}.
     * This method sets all the {@link pc.MeshInstance#visible} property on all mesh instances to true.
     */
    show: function () {
        if (this._meshInstances) {
            for (var i = 0; i < this._meshInstances.length; i++) {
                this._meshInstances[i].visible = true;
            }
        }
    },

    _setMaterial: function (material) {
        if (this._material !== material) {

            this._material = material;
            if (this._meshInstances && this._type !== 'asset') {
                for (var i = 0, len = this._meshInstances.length; i < len; i++) {
                    this._meshInstances[i].material = material;
                }
            }
        }
    },

    /**
     * @private
     * @function
     * @name pc.RenderComponent#generateWireframe
     * @description Generates the necessary internal data for this component to be
     * renderable as wireframe. Once this function has been called, any mesh
     * instance can have its renderStyle property set to pc.RENDERSTYLE_WIREFRAME.
     * @example
     * render.generateWireframe();
     * for (var i = 0; i < render.meshInstances.length; i++) {
     *     render.meshInstances[i].renderStyle = pc.RENDERSTYLE_WIREFRAME;
     * }
     */
    generateWireframe: function () {

        // Build an array of unique meshes
        var i, mesh, meshes = [];
        for (i = 0; i < this._meshInstances.length; i++) {
            mesh = this._meshInstances[i].mesh;
            if (meshes.indexOf(mesh) === -1) {
                meshes.push(mesh);
            }
        }

        for (i = 0; i < meshes.length; ++i) {
            mesh = meshes[i];
            if (!mesh.primitive[RENDERSTYLE_WIREFRAME]) {
                mesh.generateWireframe();
            }
        }
    }
});

Object.defineProperty(RenderComponent.prototype, "type", {
    get: function () {
        return this._type;
    },

    set: function (value) {

        if (this._type !== value) {
            this._area = null;
            this._type = value;

            if (value !== 'asset') {

                var primData = getShapePrimitive(this.system.app.graphicsDevice, value);
                this._area = primData.area;
                this._meshInstances = [new MeshInstance(this.entity, primData.mesh, this._material)];

                if (this.system._inTools)
                    this.generateWireframe();
            }
        }
    }
});

Object.defineProperty(RenderComponent.prototype, "meshInstances", {
    get: function () {
        return this._meshInstances;
    },

    set: function (value) {

        if (this._meshInstances) {
            this.removeFromLayers();
        }

        this._meshInstances = value;

        if (this._meshInstances) {

            var meshInstances = this._meshInstances;
            for (var i = 0; i < meshInstances.length; i++) {
                meshInstances[i].castShadow = this._castShadows;
                meshInstances[i].receiveShadow = this._receiveShadows;
                meshInstances[i].isStatic = this._isStatic;
            }

            // update meshInstances
            this.lightmapped = this._lightmapped;

            if (this.enabled && this.entity.enabled) {
                this.addToLayers();
            }
        }
    }
});

Object.defineProperty(RenderComponent.prototype, "lightmapped", {
    get: function () {
        return this._lightmapped;
    },
    set: function (value) {
        if (value !== this._lightmapped) {
            this._lightmapped = value;

            var mi = this._meshInstances;
            if (mi) {
                for (var i = 0; i < mi.length; i++) {
                    mi[i].setLightmapped(value);
                }
            }
        }
    }
});

Object.defineProperty(RenderComponent.prototype, "castShadows", {
    get: function () {
        return this._castShadows;
    },

    set: function (value) {
        if (this._castShadows !== value) {

            var i, layer, mi = this._meshInstances;

            if (mi) {
                var layers = this.layers;
                var scene = this.system.app.scene;
                if (this._castShadows && !value) {
                    for (i = 0; i < layers.length; i++) {
                        layer = this.system.app.scene.layers.getLayerById(this.layers[i]);
                        if (layer) {
                            layer.removeShadowCasters(mi);
                        }
                    }
                }

                for (i = 0; i < mi.length; i++) {
                    mi[i].castShadow = value;
                }

                if (!this._castShadows && value) {
                    for (i = 0; i < layers.length; i++) {
                        layer = scene.layers.getLayerById(layers[i]);
                        if (layer) {
                            layer.addShadowCasters(mi);
                        }
                    }
                }
            }

            this._castShadows = value;
        }
    }
});

Object.defineProperty(RenderComponent.prototype, 'receiveShadows', {
    get: function () {
        return this._receiveShadows;
    },

    set: function (value) {
        if (this._receiveShadows !== value) {

            this._receiveShadows = value;

            var mi = this._meshInstances;
            if (mi) {
                for (var i = 0; i < mi.length; i++) {
                    meshInstances[i].receiveShadow = value;
                }
            }
        }
    }
});

Object.defineProperty(RenderComponent.prototype, "castShadowsLightmap", {
    get: function () {
        return this._castShadowsLightmap;
    },

    set: function (value) {
        this._castShadowsLightmap = value;
    }
});

Object.defineProperty(RenderComponent.prototype, "lightmapSizeMultiplier", {
    get: function () {
        return this._lightmapSizeMultiplier;
    },

    set: function (value) {
        this._lightmapSizeMultiplier = value;
    }
});

Object.defineProperty(RenderComponent.prototype, "isStatic", {
    get: function () {
        return this._isStatic;
    },

    set: function (value) {
        if (this._isStatic !== value) {
            this._isStatic = value;

            var mi = this._meshInstances;
            if (mi) {
                for (var i = 0; i < mi.length; i++) {
                    mi[i].isStatic = value;
                }
            }
        }
    }
});

Object.defineProperty(RenderComponent.prototype, "layers", {
    get: function () {
        return this._layers;
    },

    set: function (value) {

        var i, layer, layers = this.system.app.scene.layers;

        if (this._meshInstances) {
            // remove all meshinstances from old layers
            for (i = 0; i < this._layers.length; i++) {
                layer = layers.getLayerById(this._layers[i]);
                if (layer) {
                    layer.removeMeshInstances(this._meshInstances);
                }
            }
        }

        // set the layer list
        this._layers.length = 0;
        for (i = 0; i < value.length; i++) {
            this._layers[i] = value[i];
        }

        // don't add into layers until we're enabled
        if (!this.enabled || !this.entity.enabled || !this._meshInstances) return;

        // add all mesh instances to new layers
        for (i = 0; i < this._layers.length; i++) {
            layer = layers.getLayerById(this._layers[i]);
            if (layer) {
                layer.addMeshInstances(this._meshInstances);
            }
        }
    }
});

Object.defineProperty(RenderComponent.prototype, "batchGroupId", {
    get: function () {
        return this._batchGroupId;
    },

    set: function (value) {
        if (this._batchGroupId !== value) {

            var batcher = this.system.app.batcher;
            if (this.entity.enabled && this._batchGroupId >= 0) {
                batcher.remove(BatchGroup.RENDER, this.batchGroupId, this.entity);
            }
            if (this.entity.enabled && value >= 0) {
                batcher.insert(BatchGroup.RENDER, value, this.entity);
            }

            if (value < 0 && this._batchGroupId >= 0 && this.enabled && this.entity.enabled) {
                // re-add model to scene, in case it was removed by batching
                this.addToLayers();
            }

            this._batchGroupId = value;
        }
    }
});

Object.defineProperty(RenderComponent.prototype, "material", {
    get: function () {
        return this._material;
    },

    set: function (value) {
        if (this._material !== value) {
            this._setMaterial(value);
        }
    }
});

export { RenderComponent };

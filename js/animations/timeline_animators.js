class GeneralAnimator {
	constructor(uuid, animation) {
		this.animation = animation;
		this.expanded = false;
		this.selected = false;
		this.uuid = uuid || guid();
		this.muted = {};
		for (let channel in this.channels) {
			this.muted[channel] = false;
		}
	}
	get keyframes() {
		let array = [];
		for (let channel in this.channels) {
			if (this[channel] && this[channel].length) array.push(...this[channel]);
		}
		return array;
	}
	select() {
		var scope = this;
		for (var key in this.animation.animators) {
			this.animation.animators[key].selected = false;
		}
		this.selected = true;
		Timeline.selected_animator = this;
		this.addToTimeline();
		Vue.nextTick(() => {
			scope.scrollTo();
		})
		return this;
	}
	addToTimeline() {
		if (!Timeline.animators.includes(this)) {
			Timeline.animators.splice(0, 0, this);
		}
		for (let channel in this.channels) {
			if (!this[channel]) this[channel] = [];
		}
		if (!this.expanded) this.expanded = true;
		return this;
	}
	addKeyframe(data, uuid) {
		var channel = data.channel;
		if (typeof channel == 'number') channel = Object.keys(this.channels)[channel];
		if (channel && this[channel]) {
			var kf = new Keyframe(data, uuid);
			this[channel].push(kf);
			kf.animator = this;
			return kf;
		}
	}
	createKeyframe(value, time, channel, undo, select) {
		if (!this.channels[channel]) return;
		if (typeof time !== 'number') time = Timeline.time;
		var keyframes = [];
		if (undo) {
			Undo.initEdit({keyframes})
		}
		var keyframe = new Keyframe({
			channel: channel,
			time: time
		});
		keyframes.push(keyframe);

		if (value) {
			keyframe.extend(value);
		} else if (this.channels[channel].transform && this.fillValues) {
			this.fillValues(keyframe, value, true);
		}

		keyframe.channel = channel;
		keyframe.time = Timeline.snapTime(time);

		this[channel].push(keyframe);
		keyframe.animator = this;

		if (select !== false) {
			keyframe.select();
		}
		var deleted = [];
		delete keyframe.time_before;
		keyframe.replaceOthers(deleted);
		Undo.addKeyframeCasualties(deleted);
		Animation.selected.setLength();

		if (undo) {
			Undo.finishEdit('Add keyframe')
		}
		return keyframe;
	}
	getOrMakeKeyframe(channel) {
		let before, result;
		let epsilon = Timeline.getStep()/2 || 0.01;

		for (let kf of this[channel]) {
			if (Math.abs(kf.time - Timeline.time) <= epsilon) {
				before = kf;
			}
		}
		result = before ? before : this.createKeyframe(null, Timeline.time, channel, false, false);
		return {before, result};
	}
	toggleMuted(channel) {
		this.muted[channel] = !this.muted[channel];
		if (this instanceof BoneAnimator) Animator.preview();
		return this;
	}
	scrollTo() {
		var el = $(`#timeline_body_inner > li[uuid=${this.uuid}]`).get(0)
		if (el) {
			var offset = el.offsetTop;
			var timeline = document.getElementById('timeline_body');
			var scroll_top = timeline.scrollTop;
			var height = timeline.clientHeight;
			if (offset < scroll_top) {
				$(timeline).animate({
					scrollTop: offset
				}, 200);
			}
			if (offset + el.clientHeight > scroll_top + height) {
				$(timeline).animate({
					scrollTop: offset - (height-el.clientHeight-20)
				}, 200);
			}
		}
	}
}
GeneralAnimator.addChannel = function(channel, options) {
	this.prototype.channels[channel] = {
		name: options.name || channel,
		transform: options.transform || false,
		mutable: options.mutable instanceof Boolean ? options.mutable : true,
		max_data_points: options.max_data_points || 0
	}
	Timeline.animators.forEach(animator => {
		if (animator instanceof this && !animator[channel]) {
			animator[channel] = [];
		}
	})
	Timeline.vue.$forceUpdate();
}
class BoneAnimator extends GeneralAnimator {
	constructor(uuid, animation, name) {
		super(uuid, animation);
		this.uuid = uuid;
		this._name = name;

		this.rotation = [];
		this.position = [];
		this.scale = [];
	}
	get name() {
		var group = this.getGroup();
		if (group) return group.name;
		return this._name;
	}
	set name(name) {
		this._name = name;
	}
	getGroup() {
		this.group = OutlinerNode.uuids[this.uuid];
		if (!this.group) {
			if (this.animation && this.animation.animators[this.uuid] && this.animation.animators[this.uuid].type == 'bone') {
				delete this.animation.bones[this.uuid];
			}
		}
		return this.group
	}
	select(group_is_selected) {
		if (!this.getGroup() || this.group.locked) return this;

		var duplicates;
		for (var key in this.animation.animators) {
			this.animation.animators[key].selected = false;
		}
		if (group_is_selected !== true && this.group) {
			this.group.select();
		}
		Group.all.forEach(group => {
			if (group.name == group.selected.name && group != Group.selected) {
				duplicates = true;
			}
		})
		function iterate(arr) {
			arr.forEach((it) => {
				if (it.type === 'group' && !duplicates) {
					if (it.name === Group.selected.name && it !== Group.selected) {
						duplicates = true;
					} else if (it.children && it.children.length) {
						iterate(it.children);
					}
				}
			})
		}
		iterate(Outliner.root);
		if (duplicates) {
			Blockbench.showMessageBox({
				translateKey: 'duplicate_groups',
				icon: 'folder',
			});
		}
		super.select();
		
		if (this[Toolbox.selected.animation_channel] && (Timeline.selected.length == 0 || Timeline.selected[0].animator != this)) {
			var nearest;
			this[Toolbox.selected.animation_channel].forEach(kf => {
				if (Math.abs(kf.time - Timeline.time) < 0.002) {
					nearest = kf;
				}
			})
			if (nearest) {
				nearest.select();
			}
		}

		if (this.group && this.group.parent && this.group.parent !== 'root') {
			this.group.parent.openUp();
		}
		return this;
	}
	fillValues(keyframe, values, allow_expression, round = true) {
		if (values instanceof Array) {
			keyframe.extend({
				data_points: [{
					x: values[0],
					y: values[1],
					z: values[2]
				}]
			})
		} else if (typeof values === 'number' || typeof values === 'string') {
			keyframe.extend({
				data_points: [{
					x: values,
					y: values,
					z: values
				}]
			})
		} else if (values === null) {
			let original_time = Timeline.time;
			Timeline.time = keyframe.time;
			var ref = this.interpolate(keyframe.channel, allow_expression)
			Timeline.time = original_time;
			if (ref) {
				if (round) {
					let e = keyframe.channel == 'scale' ? 1e4 : 1e2
					ref.forEach((r, i) => {
						if (!isNaN(r)) {
							ref[i] = Math.round(parseFloat(r)*e)/e
						}
					})
				}
				keyframe.extend({
					data_points: [{
						x: ref[0],
						y: ref[1],
						z: ref[2],
					}]
				})
			}
			let closest;
			this[keyframe.channel].forEach(kf => {
				if (!closest || Math.abs(kf.time - keyframe.time) < Math.abs(closest.time - keyframe.time)) {
					closest = kf;
				}
			});
			keyframe.extend({
				interpolation: closest && closest.interpolation,
				uniform: (keyframe.channel == 'scale')
					? (closest && closest.uniform && closest.data_points[0].x == closest.data_points[0].y && closest.data_points[0].x == closest.data_points[0].z)
					: undefined,
			})
		} else {
			keyframe.extend(values)
		}
	}
	pushKeyframe(keyframe) {
		this[keyframe.channel].push(keyframe)
		keyframe.animator = this;
		return this;
	}
	doRender() {
		this.getGroup()
		if (this.group && this.group.children && this.group.mesh) {
			let mesh = this.group.mesh
			return (mesh && mesh.fix_rotation)
		}
	}
	displayRotation(arr, multiplier = 1) {
		var bone = this.group.mesh

		if (!arr) {
		} else if (arr.length === 4) {
			var added_rotation = new THREE.Euler().setFromQuaternion(new THREE.Quaternion().fromArray(arr), 'ZYX')
			bone.rotation.x -= added_rotation.x * multiplier
			bone.rotation.y -= added_rotation.y * multiplier
			bone.rotation.z += added_rotation.z * multiplier
		} else {
			arr.forEach((n, i) => {
				bone.rotation[getAxisLetter(i)] += Math.degToRad(n) * (i == 2 ? 1 : -1) * multiplier
			})
		}
		return this;
	}
	displayPosition(arr, multiplier = 1) {
		var bone = this.group.mesh
		if (arr) {
			bone.position.x -= arr[0] * multiplier;
			bone.position.y += arr[1] * multiplier;
			bone.position.z += arr[2] * multiplier;
		}
		return this;
	}
	displayScale(arr, multiplier = 1) {
		if (!arr) return this;
		var bone = this.group.mesh;
		bone.scale.x *= (1 + (arr[0] - 1) * multiplier) || 0.00001;
		bone.scale.y *= (1 + (arr[1] - 1) * multiplier) || 0.00001;
		bone.scale.z *= (1 + (arr[2] - 1) * multiplier) || 0.00001;
		return this;
	}
	interpolate(channel, allow_expression, axis) {
		let time = Timeline.time;
		var before = false
		var after = false
		var result = false
		let epsilon = 1/1200;

		function mapAxes(cb) {
			if (axis) {
				let result = cb(axis);
				Animator._last_values[channel][axis] = result;
				return result;
			} else {
				return ['x', 'y', 'z'].map(axis => {
					let result = cb(axis);
					Animator._last_values[channel][axis] = result;
					return result;
				});
			}
		}

		for (var keyframe of this[channel]) {

			if (keyframe.time < time) {
				if (!before || keyframe.time > before.time) {
					before = keyframe
				}
			} else  {
				if (!after || keyframe.time < after.time) {
					after = keyframe
				}
			}
			i++;
		}
		if (before && Math.epsilon(before.time, time, epsilon)) {
			result = before
		} else if (after && Math.epsilon(after.time, time, epsilon)) {
			result = after
		} else if (before && !after) {
			result = before
		} else if (after && !before) {
			result = after
		} else if (!before && !after) {
			//
		} else {
			let no_interpolations = Blockbench.hasFlag('no_interpolations')
			let alpha = Math.lerp(before.time, after.time, time)

			if (no_interpolations || (before.interpolation == Keyframe.interpolation.linear && after.interpolation == Keyframe.interpolation.linear)) {
				if (no_interpolations) {
					alpha = Math.round(alpha)
				}
				return mapAxes(axis => before.getLerp(after, axis, alpha, allow_expression));
			} else {

				let sorted = this[channel].slice().sort((kf1, kf2) => (kf1.time - kf2.time));
				let before_index = sorted.indexOf(before);
				let before_plus = sorted[before_index-1];
				let after_plus = sorted[before_index+2];

				return mapAxes(axis => before.getCatmullromLerp(before_plus, before, after, after_plus, axis, alpha));
			}
		}
		if (result && result instanceof Keyframe) {
			let keyframe = result
			let method = allow_expression ? 'get' : 'calc'
			let dp_index = (keyframe.time > time || Math.epsilon(keyframe.time, time, epsilon)) ? 0 : keyframe.data_points.length-1;

			return mapAxes(axis => keyframe[method](axis, dp_index));
		}
		return false;
	}
	displayFrame(multiplier = 1) {
		if (!this.doRender()) return;
		this.getGroup()

		if (!this.muted.rotation) this.displayRotation(this.interpolate('rotation'), multiplier)
		if (!this.muted.position) this.displayPosition(this.interpolate('position'), multiplier)
		if (!this.muted.scale) this.displayScale(this.interpolate('scale'), multiplier)
	}
}
	BoneAnimator.prototype.type = 'bone';
	BoneAnimator.prototype.channels = {
		rotation: {name: tl('timeline.rotation'), mutable: true, transform: true, max_data_points: 2},
		position: {name: tl('timeline.position'), mutable: true, transform: true, max_data_points: 2},
		scale: {name: tl('timeline.scale'), mutable: true, transform: true, max_data_points: 2},
	}
class NullObjectAnimator extends BoneAnimator {
	constructor(uuid, animation, name) {
		super(uuid, animation);
		this.uuid = uuid;
		this._name = name;

		this.position = [];
	}
	get name() {
		var element = this.getElement();
		if (element) return element.name;
		return this._name;
	}
	set name(name) {
		this._name = name;
	}
	getElement() {
		this.element = OutlinerNode.uuids[this.uuid];
		if (!this.element) {
			if (this.animation && this.animation.animators[this.uuid] && this.animation.animators[this.uuid].type == 'bone') {
				delete this.animation.bones[this.uuid];
			}
		}
		return this.element
	}
	select(element_is_selected) {
		if (!this.getElement() || this.getElement().locked) return this;

		if (element_is_selected !== true && this.element) {
			this.element.select();
		}
		GeneralAnimator.prototype.select.call(this);
		
		if (this[Toolbox.selected.animation_channel] && (Timeline.selected.length == 0 || Timeline.selected[0].animator != this)) {
			var nearest;
			this[Toolbox.selected.animation_channel].forEach(kf => {
				if (Math.abs(kf.time - Timeline.time) < 0.002) {
					nearest = kf;
				}
			})
			if (nearest) {
				nearest.select();
			}
		}

		if (this.element && this.element.parent && this.element.parent !== 'root') {
			this.element.parent.openUp();
		}
		return this;
	}
	doRender() {
		this.getElement()
		return (this.element && this.element && this.element.mesh);
	}
	displayPosition(arr, multiplier = 1) {
		var bone = this.element.mesh
		if (arr) {
			bone.position.x -= arr[0] * multiplier;
			bone.position.y += arr[1] * multiplier;
			bone.position.z += arr[2] * multiplier;
		}
		return this;
	}
	displayIK() {
		
		let null_object = this.getElement();
		let target = Group.all.find(group => group.name == null_object.ik_target);
		if (!null_object || !target) return;

		let bones = [];
		let current = target.parent;
		while (current !== null_object.parent) {
			bones.push(current);
			current = current.parent;
		}
		bones.reverse();


		let solver = new FIK.Structure3D(scene);
		let chain = new FIK.Chain3D();

		let bone_references = [];

		bones.forEach((bone, i) => {

			let startPoint = new FIK.V3(0,0,0).copy(bone.mesh.getWorldPosition(new THREE.Vector3()))
			let endPoint = new FIK.V3(0,0,0).copy(bones[i+1] ? bones[i+1].mesh.getWorldPosition(new THREE.Vector3()) : null_object.getWorldCenter())

			let ik_bone = new FIK.Bone3D(startPoint, endPoint)
			chain.addBone(ik_bone)
			bone_references.push({
				bone,
				ik_bone,
				last_rotation: new THREE.Euler().copy(bone.mesh.rotation),
				ik_bone,
				last_diff: new THREE.Vector3(
					(bones[i+1] ? bones[i+1].origin[0] : null_object.from[0]) - bone.origin[0],
					(bones[i+1] ? bones[i+1].origin[1] : null_object.from[1]) - bone.origin[1],
					(bones[i+1] ? bones[i+1].origin[2] : null_object.from[2]) - bone.origin[2]
				)
			})
		})


		let ik_target = new THREE.Vector3().copy(Transformer.position);

		solver.add(chain, ik_target , true);
		solver.meshChains[0].forEach(mesh => {
			//mesh.visible = false;
			scene.add(mesh)
		})






		solver.update();
		let lim = 12;
	
		bone_references.forEach((bone, i) => {
			
	
				let euler = new THREE.Euler()
				let q = new THREE.Quaternion()
				
				let start = new THREE.Vector3().copy(solver.chains[0].bones[i].start)
				let end = new THREE.Vector3().copy(solver.chains[0].bones[i].end)
				bone_references[i].bone.mesh.worldToLocal(start)
				bone_references[i].bone.mesh.worldToLocal(end)
				let diff = new THREE.Vector3().copy(end).sub(start)
				
				let v1 = new THREE.Vector3().copy(diff).normalize();
				let v2 = new THREE.Vector3().copy(bone.last_diff).normalize();
				//v1.x *= -1;
				//v2.x *= -1;
	
				q.setFromUnitVectors(v1, v2)
				euler.setFromQuaternion(q)

				//console.log(euler)
				//euler.x *= -1;

				bone.bone.mesh.rotation.copy(euler)
	
				//keyframe.offset('x', Math.clamp(Math.radToDeg(euler.x), -lim, lim));
				//keyframe.offset('y', Math.clamp(Math.radToDeg(euler.y), -lim, lim));
				//keyframe.offset('z', Math.clamp(Math.radToDeg(euler.z), -lim, lim));

		})

		//console.log({solver, chain,bones, bone_references,ik_target})

		setTimeout(() => {
			solver.meshChains[0].forEach(mesh => {
				scene.remove(mesh)
			})
		}, 1200)
	}
	displayFrame(multiplier = 1) {
		if (!this.doRender()) return;
		this.getElement()

		if (!this.muted.position) {
			this.displayPosition(this.interpolate('position'), multiplier);
			this.displayIK();
		}
	}
}
	NullObjectAnimator.prototype.type = 'null_object';
	NullObjectAnimator.prototype.channels = {
		position: {name: tl('timeline.position'), mutable: true, transform: true, max_data_points: 2},
	}

class EffectAnimator extends GeneralAnimator {
	constructor(animation) {
		super(null, animation);

		this.name = tl('timeline.effects')
		this.selected = false;

		for (let channel in this.channels) {
			this[channel] = [];
		}
	}
	pushKeyframe(keyframe) {
		this[keyframe.channel].push(keyframe)
		keyframe.animator = this;
		return this;
	}
	displayFrame(in_loop) {
		if (in_loop && !this.muted.sound) {
			this.sound.forEach(kf => {
				var diff = kf.time - Timeline.time;
				if (diff >= 0 && diff < (1/60) * (Timeline.playback_speed/100)) {
					if (kf.data_points[0].file && !kf.cooldown) {
						var media = new Audio(kf.data_points[0].file);
						media.playbackRate = Math.clamp(Timeline.playback_speed/100, 0.1, 4.0);
						media.volume = Math.clamp(settings.volume.value/100, 0, 1);
						media.play().catch(() => {});
						Timeline.playing_sounds.push(media);
						media.onended = function() {
							Timeline.playing_sounds.remove(media);
						}

						kf.cooldown = true;
						setTimeout(() => {
							delete kf.cooldown;
						}, 400)
					} 
				}
			})
		}
		
		if (!this.muted.particle) {
			this.particle.forEach(kf => {
				var diff = Timeline.time - kf.time;
				if (diff >= 0) {
					let i = 0;
					for (var data_point of kf.data_points) {
						let particle_effect = data_point.file && Animator.particle_effects[data_point.file]
						if (particle_effect) {

							let emitter = particle_effect.emitters[kf.uuid + i];
							if (!emitter) {
								emitter = particle_effect.emitters[kf.uuid + i] = new Wintersky.Emitter(WinterskyScene, particle_effect.config);
							}

							var locator = data_point.locator && Locator.all.find(l => l.name == data_point.locator)
							if (locator) {
								locator.mesh.add(emitter.local_space);
								emitter.parent_mode = 'locator';
							} else {
								emitter.parent_mode = 'entity';
							}
							scene.add(emitter.global_space);
							emitter.jumpTo(diff);
						} 
						i++;
					}
				}
			})
		}
	}
	startPreviousSounds() {
		if (!this.muted.sound) {
			this.sound.forEach(kf => {
				if (kf.data_points[0].file && !kf.cooldown) {
					var diff = kf.time - Timeline.time;
					if (diff < 0 && Timeline.waveforms[kf.data_points[0].file] && Timeline.waveforms[kf.data_points[0].file].duration > -diff) {
						var media = new Audio(kf.data_points[0].file);
						media.playbackRate = Math.clamp(Timeline.playback_speed/100, 0.1, 4.0);
						media.volume = Math.clamp(settings.volume.value/100, 0, 1);
						media.currentTime = -diff;
						media.play().catch(() => {});
						Timeline.playing_sounds.push(media);
						media.onended = function() {
							Timeline.playing_sounds.remove(media);
						}

						kf.cooldown = true;
						setTimeout(() => {
							delete kf.cooldown;
						}, 400)
					} 
				}
			})
		}
	}
}
	EffectAnimator.prototype.type = 'effect';
	EffectAnimator.prototype.channels = {
		particle: {name: tl('timeline.particle'), mutable: true, max_data_points: 1000},
		sound: {name: tl('timeline.sound'), mutable: true, max_data_points: 1000},
		timeline: {name: tl('timeline.timeline'), mutable: false, max_data_points: 1},
	}
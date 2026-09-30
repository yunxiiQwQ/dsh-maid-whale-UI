import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
//#region node_modules/.pnpm/@deepseek-ai+cosmokit@1.8.2/node_modules/@deepseek-ai/cosmokit/lib/index.js
/** Return true when a value is `null` or `undefined`. */
function isNullable(value) {
	return value === null || value === void 0;
}
/** Return true for non-array object values. */
function isPlainObject(data) {
	return data && typeof data === "object" && !Array.isArray(data);
}
/** Filter object entries and return a new object. */
function filterKeys(object, filter) {
	return Object.fromEntries(Object.entries(object).filter(([key, value]) => filter(key, value)));
}
/** Map object values while preserving the original key set. */
function mapValues(object, transform) {
	return Object.fromEntries(Object.entries(object).map(([key, value]) => [key, transform(value, key)]));
}
/** Pick selected keys from an object, optionally including `undefined` values. */
function pick(source, keys, forced) {
	if (!keys) return { ...source };
	const result = {};
	for (const key of keys) if (forced || source[key] !== void 0) result[key] = source[key];
	return result;
}
/** Test values using `instanceof` with a `toStringTag` fallback. */
function is(type, value) {
	if (arguments.length === 1) return (value) => is(type, value);
	return type in globalThis && value instanceof globalThis[type] || Object.prototype.toString.call(value).slice(8, -1) === type;
}
function isArrayBufferLike(value) {
	return is("ArrayBuffer", value) || is("SharedArrayBuffer", value);
}
function isArrayBufferSource(value) {
	return isArrayBufferLike(value) || ArrayBuffer.isView(value);
}
/** Binary source detection and base64/hex conversion helpers. */
var Binary;
(function(Binary) {
	Binary.is = isArrayBufferLike;
	Binary.isSource = isArrayBufferSource;
	function fromSource(source) {
		if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
		else return source;
	}
	Binary.fromSource = fromSource;
	function toBase64(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("base64");
		let binary = "";
		const bytes = new Uint8Array(source);
		for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
		return btoa(binary);
	}
	Binary.toBase64 = toBase64;
	function fromBase64(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "base64"));
		return Uint8Array.from(atob(source), (c) => c.charCodeAt(0));
	}
	Binary.fromBase64 = fromBase64;
	function toHex(source) {
		source = fromSource(source);
		if (typeof Buffer !== "undefined") return Buffer.from(source).toString("hex");
		return Array.from(new Uint8Array(source), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	Binary.toHex = toHex;
	function fromHex(source) {
		if (typeof Buffer !== "undefined") return fromSource(Buffer.from(source, "hex"));
		const hex = source.length % 2 === 0 ? source : source.slice(0, source.length - 1);
		const buffer = [];
		for (let i = 0; i < hex.length; i += 2) buffer.push(parseInt(`${hex[i]}${hex[i + 1]}`, 16));
		return Uint8Array.from(buffer).buffer;
	}
	Binary.fromHex = fromHex;
})(Binary || (Binary = {}));
Binary.fromBase64;
Binary.toBase64;
Binary.fromHex;
Binary.toHex;
/** Deep-clone common JavaScript values while preserving prototypes and cycles. */
function clone(source, refs = /* @__PURE__ */ new Map()) {
	if (!source || typeof source !== "object") return source;
	if (is("Date", source)) return new Date(source.valueOf());
	if (is("RegExp", source)) return new RegExp(source.source, source.flags);
	if (isArrayBufferLike(source)) return source.slice(0);
	if (ArrayBuffer.isView(source)) return source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength);
	const cached = refs.get(source);
	if (cached) return cached;
	if (Array.isArray(source)) {
		const result = [];
		refs.set(source, result);
		source.forEach((value, index) => {
			result[index] = Reflect.apply(clone, null, [value, refs]);
		});
		return result;
	}
	const result = Object.create(Object.getPrototypeOf(source));
	refs.set(source, result);
	for (const key of Reflect.ownKeys(source)) {
		const descriptor = { ...Reflect.getOwnPropertyDescriptor(source, key) };
		if ("value" in descriptor) descriptor.value = Reflect.apply(clone, null, [descriptor.value, refs]);
		Reflect.defineProperty(result, key, descriptor);
	}
	return result;
}
/** Deeply compare arrays, dates, regexps, buffers, and plain object fields. */
function deepEqual(a, b, strict) {
	if (a === b) return true;
	if (!strict && isNullable(a) && isNullable(b)) return true;
	if (typeof a !== typeof b) return false;
	if (typeof a !== "object") return false;
	if (!a || !b) return false;
	function check(test, then) {
		return test(a) ? test(b) ? then(a, b) : false : test(b) ? false : void 0;
	}
	return check(Array.isArray, (a, b) => a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))) ?? check(is("Date"), (a, b) => a.valueOf() === b.valueOf()) ?? check(is("RegExp"), (a, b) => a.source === b.source && a.flags === b.flags) ?? check(isArrayBufferLike, (a, b) => {
		if (a.byteLength !== b.byteLength) return false;
		const viewA = new Uint8Array(a);
		const viewB = new Uint8Array(b);
		for (let i = 0; i < viewA.length; i++) if (viewA[i] !== viewB[i]) return false;
		return true;
	}) ?? Object.keys({
		...a,
		...b
	}).every((key) => deepEqual(a[key], b[key], strict));
}
/** Time constants plus parsing and formatting helpers. */
var Time;
(function(Time) {
	Time.millisecond = 1;
	Time.second = 1e3;
	Time.minute = Time.second * 60;
	Time.hour = Time.minute * 60;
	Time.day = Time.hour * 24;
	Time.week = Time.day * 7;
	let timezoneOffset = (/* @__PURE__ */ new Date()).getTimezoneOffset();
	function setTimezoneOffset(offset) {
		timezoneOffset = offset;
	}
	Time.setTimezoneOffset = setTimezoneOffset;
	function getTimezoneOffset() {
		return timezoneOffset;
	}
	Time.getTimezoneOffset = getTimezoneOffset;
	function getDateNumber(date = /* @__PURE__ */ new Date(), offset) {
		if (typeof date === "number") date = new Date(date);
		if (offset === void 0) offset = timezoneOffset;
		return Math.floor((date.valueOf() / Time.minute - offset) / 1440);
	}
	Time.getDateNumber = getDateNumber;
	function fromDateNumber(value, offset) {
		const date = new Date(value * Time.day);
		if (offset === void 0) offset = timezoneOffset;
		return new Date(+date + offset * Time.minute);
	}
	Time.fromDateNumber = fromDateNumber;
	const numeric = /\d+(?:\.\d+)?/.source;
	const timeRegExp = new RegExp(`^${[
		"w(?:eek(?:s)?)?",
		"d(?:ay(?:s)?)?",
		"h(?:our(?:s)?)?",
		"m(?:in(?:ute)?(?:s)?)?",
		"s(?:ec(?:ond)?(?:s)?)?"
	].map((unit) => `(${numeric}${unit})?`).join("")}$`);
	function parseTime(source) {
		const capture = timeRegExp.exec(source);
		if (!capture) return 0;
		return (parseFloat(capture[1]) * Time.week || 0) + (parseFloat(capture[2]) * Time.day || 0) + (parseFloat(capture[3]) * Time.hour || 0) + (parseFloat(capture[4]) * Time.minute || 0) + (parseFloat(capture[5]) * Time.second || 0);
	}
	Time.parseTime = parseTime;
	function parseDate(date) {
		const parsed = parseTime(date);
		if (parsed) date = Date.now() + parsed;
		else if (/^\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).toLocaleDateString()}-${date}`;
		else if (/^\d{1,2}-\d{1,2}-\d{1,2}(:\d{1,2}){1,2}$/.test(date)) date = `${(/* @__PURE__ */ new Date()).getFullYear()}-${date}`;
		return date ? new Date(date) : /* @__PURE__ */ new Date();
	}
	Time.parseDate = parseDate;
	function format(ms) {
		const abs = Math.abs(ms);
		if (abs >= Time.day - Time.hour / 2) return Math.round(ms / Time.day) + "d";
		else if (abs >= Time.hour - Time.minute / 2) return Math.round(ms / Time.hour) + "h";
		else if (abs >= Time.minute - Time.second / 2) return Math.round(ms / Time.minute) + "m";
		else if (abs >= Time.second) return Math.round(ms / Time.second) + "s";
		return ms + "ms";
	}
	Time.format = format;
	function toDigits(source, length = 2) {
		return source.toString().padStart(length, "0");
	}
	Time.toDigits = toDigits;
	function template(template, time = /* @__PURE__ */ new Date()) {
		return template.replace("yyyy", time.getFullYear().toString()).replace("yy", time.getFullYear().toString().slice(2)).replace("MM", toDigits(time.getMonth() + 1)).replace("dd", toDigits(time.getDate())).replace("hh", toDigits(time.getHours())).replace("mm", toDigits(time.getMinutes())).replace("ss", toDigits(time.getSeconds())).replace("SSS", toDigits(time.getMilliseconds(), 3));
	}
	Time.template = template;
})(Time || (Time = {}));
//#endregion
//#region node_modules/.pnpm/@deepseek-ai+schemastery@3.18.1/node_modules/@deepseek-ai/schemastery/lib/index.mjs
const kSchema = Symbol.for("schemastery");
const kValidationError = Symbol.for("ValidationError");
globalThis.__schemastery_index__ ??= 0;
globalThis.__schemastery_refs__ = void 0;
var ValidationError = class extends TypeError {
	options;
	name = "ValidationError";
	constructor(message, options) {
		let prefix = "$";
		for (const segment of options.path || []) if (typeof segment === "string") prefix += "." + segment;
		else if (typeof segment === "number") prefix += "[" + segment + "]";
		else if (typeof segment === "symbol") prefix += `[Symbol(${segment.toString()})]`;
		if (prefix.startsWith(".")) prefix = prefix.slice(1);
		super((prefix === "$" ? "" : `${prefix} `) + message);
		this.options = options;
	}
	static is(error) {
		return !!error?.[kValidationError];
	}
};
Object.defineProperty(ValidationError.prototype, kValidationError, { value: true });
const Schema = function(options) {
	const schema = function(data, options = {}) {
		return Schema.resolve(data, schema, options)[0];
	};
	if (options.refs) {
		const refs = mapValues(options.refs, (options) => new Schema(options));
		const getRef = (uid) => refs[uid];
		for (const key in refs) {
			const options = refs[key];
			options.sKey = getRef(options.sKey);
			options.inner = getRef(options.inner);
			options.list = options.list && options.list.map(getRef);
			options.dict = options.dict && mapValues(options.dict, getRef);
		}
		return refs[options.uid];
	}
	Object.assign(schema, options);
	if (typeof schema.callback === "string") try {
		schema.callback = new Function("return " + schema.callback)();
	} catch {}
	Object.defineProperty(schema, "uid", { value: globalThis.__schemastery_index__++ });
	Object.setPrototypeOf(schema, Schema.prototype);
	schema.meta ||= {};
	schema.toString = schema.toString.bind(schema);
	return schema;
};
Schema.prototype = Object.create(Function.prototype);
Schema.prototype[kSchema] = true;
Object.defineProperty(Schema.prototype, "~standard", { get() {
	return {
		version: 1,
		vendor: "schemastery",
		validate: (value) => {
			try {
				return { value: Schema.resolve(value, this, {})[0] };
			} catch (error) {
				if (ValidationError.is(error)) return { issues: [{
					message: error.message,
					path: error.options.path
				}] };
				throw error;
			}
		}
	};
} });
Schema.ValidationError = ValidationError;
Schema.prototype.toJSON = function toJSON() {
	if (globalThis.__schemastery_refs__) {
		globalThis.__schemastery_refs__[this.uid] ??= JSON.parse(JSON.stringify({ ...this }));
		return this.uid;
	}
	globalThis.__schemastery_refs__ = { [this.uid]: { ...this } };
	globalThis.__schemastery_refs__[this.uid] = JSON.parse(JSON.stringify({ ...this }));
	const result = {
		uid: this.uid,
		refs: globalThis.__schemastery_refs__
	};
	globalThis.__schemastery_refs__ = void 0;
	return result;
};
Schema.prototype.set = function set(key, value) {
	this.dict[key] = value;
	return this;
};
Schema.prototype.push = function push(value) {
	this.list.push(value);
	return this;
};
function mergeDesc(original, messages) {
	const result = typeof original === "string" ? { "": original } : { ...original };
	for (const locale in messages) {
		const value = messages[locale];
		if (value?.$description || value?.$desc) result[locale] = value.$description || value.$desc;
		else if (typeof value === "string") result[locale] = value;
	}
	return result;
}
function getInner(value) {
	return value?.$value ?? value?.$inner;
}
function extractKeys(data) {
	return filterKeys(data ?? {}, (key) => !key.startsWith("$"));
}
Schema.prototype.i18n = function i18n(messages) {
	const schema = Schema(this);
	const desc = mergeDesc(schema.meta.description, messages);
	if (Object.keys(desc).length) schema.meta.description = desc;
	if (schema.dict) schema.dict = mapValues(schema.dict, (inner, key) => {
		return inner.i18n(mapValues(messages, (data) => getInner(data)?.[key] ?? data?.[key]));
	});
	if (schema.list) schema.list = schema.list.map((inner, index) => {
		return inner.i18n(mapValues(messages, (data = {}) => {
			if (Array.isArray(getInner(data))) return getInner(data)[index];
			if (Array.isArray(data)) return data[index];
			return extractKeys(data);
		}));
	});
	if (schema.inner) schema.inner = schema.inner.i18n(mapValues(messages, (data) => {
		if (getInner(data)) return getInner(data);
		return extractKeys(data);
	}));
	if (schema.sKey) schema.sKey = schema.sKey.i18n(mapValues(messages, (data) => data?.$key));
	return schema;
};
Schema.prototype.extra = function extra(key, value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
};
for (const key of [
	"required",
	"disabled",
	"collapse",
	"hidden",
	"loose"
]) Object.assign(Schema.prototype, { [key](value = true) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
Schema.prototype.deprecated = function deprecated() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "deprecated",
		type: "danger"
	});
	return schema;
};
Schema.prototype.experimental = function experimental() {
	const schema = Schema(this);
	schema.meta.badges ||= [];
	schema.meta.badges.push({
		text: "experimental",
		type: "warning"
	});
	return schema;
};
Schema.prototype.pattern = function pattern(regexp) {
	const schema = Schema(this);
	const pattern = pick(regexp, ["source", "flags"]);
	schema.meta = {
		...schema.meta,
		pattern
	};
	return schema;
};
Schema.prototype.simplify = function simplify(value) {
	if (deepEqual(value, this.meta.default, this.type === "dict")) return null;
	if (isNullable(value)) return value;
	if (this.type === "object" || this.type === "dict") {
		const result = {};
		for (const key in value) {
			const item = (this.type === "object" ? this.dict[key] : this.inner)?.simplify(value[key]);
			if (this.type === "dict" || !isNullable(item)) result[key] = item;
		}
		if (deepEqual(result, this.meta.default, this.type === "dict")) return null;
		return result;
	} else if (this.type === "array" || this.type === "tuple") {
		const result = [];
		value.forEach((value, index) => {
			const schema = this.type === "array" ? this.inner : this.list[index];
			const item = schema ? schema.simplify(value) : value;
			result.push(item);
		});
		return result;
	} else if (this.type === "intersect") {
		const result = {};
		for (const item of this.list) Object.assign(result, item.simplify(value));
		return result;
	} else if (this.type === "union") for (const schema of this.list) try {
		Schema.resolve(value, schema, {});
		return schema.simplify(value);
	} catch {}
	return value;
};
Schema.prototype.toString = function toString(inline) {
	return formatters[this.type]?.(this, inline) ?? `Schema<${this.type}>`;
};
Schema.prototype.role = function role(role, extra) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		role,
		extra
	};
	return schema;
};
for (const key of [
	"default",
	"link",
	"comment",
	"description",
	"max",
	"min",
	"step"
]) Object.assign(Schema.prototype, { [key](value) {
	const schema = Schema(this);
	schema.meta = {
		...schema.meta,
		[key]: value
	};
	return schema;
} });
const resolvers = {};
Schema.extend = function extend(type, resolve) {
	resolvers[type] = resolve;
};
Schema.resolve = function resolve(data, schema, options = {}, strict = false) {
	if (!schema) return [data];
	if (options.ignore?.(data, schema)) return [data];
	if (isNullable(data) && schema.type !== "lazy") {
		if (schema.meta.required) throw new ValidationError(`missing required value`, options);
		let current = schema;
		let fallback = schema.meta.default;
		while (current?.type === "intersect" && isNullable(fallback)) {
			current = current.list[0];
			fallback = current?.meta.default;
		}
		if (isNullable(fallback)) return [data];
		data = clone(fallback);
	}
	const callback = resolvers[schema.type];
	if (!callback) throw new ValidationError(`unsupported type "${schema.type}"`, options);
	try {
		return callback(data, schema, options, strict);
	} catch (error) {
		if (!schema.meta.loose) throw error;
		return [schema.meta.default];
	}
};
Schema.from = function from(source) {
	if (isNullable(source)) return Schema.any();
	else if ([
		"string",
		"number",
		"boolean"
	].includes(typeof source)) return Schema.const(source).required();
	else if (source[kSchema]) return source;
	else if (typeof source === "function") switch (source) {
		case String: return Schema.string().required();
		case Number: return Schema.number().required();
		case Boolean: return Schema.boolean().required();
		case Function: return Schema.function().required();
		default: return Schema.is(source).required();
	}
	else throw new TypeError(`cannot infer schema from ${source}`);
};
Schema.lazy = function lazy(builder) {
	const toJSON = () => {
		if (!schema.inner[kSchema]) {
			schema.inner = schema.builder();
			schema.inner.meta = {
				...schema.meta,
				...schema.inner.meta
			};
		}
		return schema.inner.toJSON();
	};
	const schema = new Schema({
		type: "lazy",
		builder,
		inner: { toJSON }
	});
	return schema;
};
Schema.natural = function natural() {
	return Schema.number().step(1).min(0);
};
Schema.percent = function percent() {
	return Schema.number().step(.01).min(0).max(1).role("slider");
};
Schema.date = function date() {
	return Schema.union([Schema.is(Date), Schema.transform(Schema.string().role("datetime"), (value, options) => {
		const date = new Date(value);
		if (isNaN(+date)) throw new ValidationError(`invalid date "${value}"`, options);
		return date;
	}, true)]);
};
Schema.regExp = function regExp(flag = "") {
	return Schema.union([Schema.is(RegExp), Schema.transform(Schema.string().role("regexp", { flag }), (value, options) => {
		try {
			return new RegExp(value, flag);
		} catch (e) {
			throw new ValidationError(e.message, options);
		}
	}, true)]);
};
Schema.arrayBuffer = function arrayBuffer(encoding) {
	return Schema.union([
		Schema.is(ArrayBuffer),
		Schema.is(SharedArrayBuffer),
		Schema.transform(Schema.any(), (value, options) => {
			if (Binary.isSource(value)) return Binary.fromSource(value);
			throw new ValidationError(`expected ArrayBufferSource but got ${value}`, options);
		}, true),
		...encoding ? [Schema.transform(Schema.string(), (value, options) => {
			try {
				return encoding === "base64" ? Binary.fromBase64(value) : Binary.fromHex(value);
			} catch (e) {
				throw new ValidationError(e.message, options);
			}
		}, true)] : []
	]);
};
Schema.extend("lazy", (data, schema, options, strict) => {
	if (!schema.inner[kSchema]) {
		schema.inner = schema.builder();
		schema.inner.meta = {
			...schema.meta,
			...schema.inner.meta
		};
	}
	return Schema.resolve(data, schema.inner, options, strict);
});
Schema.extend("any", (data) => {
	return [data];
});
Schema.extend("never", (data, _, options) => {
	throw new ValidationError(`expected nullable but got ${data}`, options);
});
Schema.extend("const", (data, { value }, options) => {
	if (deepEqual(data, value)) return [value];
	throw new ValidationError(`expected ${value} but got ${data}`, options);
});
function checkWithinRange(data, meta, description, options, skipMin = false) {
	const { max = Infinity, min = -Infinity } = meta;
	if (data > max) throw new ValidationError(`expected ${description} <= ${max} but got ${data}`, options);
	if (data < min && !skipMin) throw new ValidationError(`expected ${description} >= ${min} but got ${data}`, options);
}
Schema.extend("string", (data, { meta }, options) => {
	if (typeof data !== "string") throw new ValidationError(`expected string but got ${data}`, options);
	if (meta.pattern) {
		const regexp = new RegExp(meta.pattern.source, meta.pattern.flags);
		if (!regexp.test(data)) throw new ValidationError(`expect string to match regexp ${regexp}`, options);
	}
	checkWithinRange(data.length, meta, "string length", options);
	return [data];
});
function decimalShift(data, digits) {
	const str = data.toString();
	if (str.includes("e")) return data * Math.pow(10, digits);
	const index = str.indexOf(".");
	if (index === -1) return data * Math.pow(10, digits);
	const frac = str.slice(index + 1);
	const integer = str.slice(0, index);
	if (frac.length <= digits) return +(integer + frac.padEnd(digits, "0"));
	return +(integer + frac.slice(0, digits) + "." + frac.slice(digits));
}
function isMultipleOf(data, min, step) {
	step = Math.abs(step);
	if (!/^\d+\.\d+$/.test(step.toString())) return (data - min) % step === 0;
	const index = step.toString().indexOf(".");
	const digits = step.toString().slice(index + 1).length;
	return Math.abs(decimalShift(data, digits) - decimalShift(min, digits)) % decimalShift(step, digits) === 0;
}
Schema.extend("number", (data, { meta }, options) => {
	if (typeof data !== "number") throw new ValidationError(`expected number but got ${data}`, options);
	checkWithinRange(data, meta, "number", options);
	const { step } = meta;
	if (step && !isMultipleOf(data, meta.min ?? 0, step)) throw new ValidationError(`expected number multiple of ${step} but got ${data}`, options);
	return [data];
});
Schema.extend("boolean", (data, _, options) => {
	if (typeof data === "boolean") return [data];
	throw new ValidationError(`expected boolean but got ${data}`, options);
});
Schema.extend("bitset", (data, { bits, meta }, options) => {
	let value = 0, keys = [];
	if (typeof data === "number") {
		value = data;
		for (const key in bits) if (data & bits[key]) keys.push(key);
	} else if (Array.isArray(data)) {
		keys = data;
		for (const key of keys) {
			if (typeof key !== "string") throw new ValidationError(`expected string but got ${key}`, options);
			if (key in bits) value |= bits[key];
		}
	} else throw new ValidationError(`expected number or array but got ${data}`, options);
	if (value === meta.default) return [value];
	return [value, keys];
});
Schema.extend("function", (data, _, options) => {
	if (typeof data === "function") return [data];
	throw new ValidationError(`expected function but got ${data}`, options);
});
Schema.extend("is", (data, { constructor }, options) => {
	if (typeof constructor === "function") {
		if (data instanceof constructor) return [data];
		throw new ValidationError(`expected ${constructor.name} but got ${data}`, options);
	} else {
		if (isNullable(data)) throw new ValidationError(`expected ${constructor} but got ${data}`, options);
		let prototype = Object.getPrototypeOf(data);
		while (prototype) {
			if (prototype.constructor?.name === constructor) return [data];
			prototype = Object.getPrototypeOf(prototype);
		}
		throw new ValidationError(`expected ${constructor} but got ${data}`, options);
	}
});
function property(data, key, schema, options) {
	try {
		const [value, adapted] = Schema.resolve(data[key], schema, {
			...options,
			path: [...options.path || [], key]
		});
		if (adapted !== void 0) data[key] = adapted;
		return value;
	} catch (e) {
		if (!options?.autofix) throw e;
		delete data[key];
		return schema.meta.default;
	}
}
Schema.extend("array", (data, { inner, meta }, options) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	checkWithinRange(data.length, meta, "array length", options, !isNullable(inner.meta.default));
	return [data.map((_, index) => property(data, index, inner, options))];
});
Schema.extend("dict", (data, { inner, sKey }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in data) {
		let rKey;
		try {
			rKey = Schema.resolve(key, sKey, options)[0];
		} catch (error) {
			if (strict) continue;
			throw error;
		}
		result[rKey] = property(data, key, inner, options);
		data[rKey] = data[key];
		if (key !== rKey) delete data[key];
	}
	return [result];
});
Schema.extend("tuple", (data, { list }, options, strict) => {
	if (!Array.isArray(data)) throw new ValidationError(`expected array but got ${data}`, options);
	const result = list.map((inner, index) => property(data, index, inner, options));
	if (strict) return [result];
	result.push(...data.slice(list.length));
	return [result];
});
function merge(result, data) {
	for (const key in data) {
		if (key in result) continue;
		result[key] = data[key];
	}
}
Schema.extend("object", (data, { dict }, options, strict) => {
	if (!isPlainObject(data)) throw new ValidationError(`expected object but got ${data}`, options);
	const result = {};
	for (const key in dict) {
		const value = property(data, key, dict[key], options);
		if (!isNullable(value) || key in data) result[key] = value;
	}
	if (!strict) merge(result, data);
	return [result];
});
Schema.extend("union", (data, { list, toString }, options, strict) => {
	const messages = [];
	for (const inner of list) try {
		return Schema.resolve(data, inner, options, strict);
	} catch (error) {
		messages.push(error);
	}
	throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
});
Schema.extend("intersect", (data, { list, toString }, options, strict) => {
	if (!list.length) return [data];
	let result;
	for (const inner of list) {
		const value = Schema.resolve(data, inner, options, true)[0];
		if (isNullable(value)) continue;
		if (isNullable(result)) result = value;
		else if (typeof result !== typeof value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
		else if (typeof value === "object") merge(result ??= {}, value);
		else if (result !== value) throw new ValidationError(`expected ${toString()} but got ${JSON.stringify(data)}`, options);
	}
	if (!strict && isPlainObject(data)) merge(result, data);
	return [result];
});
Schema.extend("transform", (data, { inner, callback, preserve }, options) => {
	const [result, adapted = data] = Schema.resolve(data, inner, options, true);
	if (preserve) return [callback(result)];
	else return [callback(result), callback(adapted)];
});
const formatters = {};
function defineMethod(name, keys, format) {
	formatters[name] = format;
	Object.assign(Schema, { [name](...args) {
		const schema = new Schema({ type: name });
		keys.forEach((key, index) => {
			switch (key) {
				case "sKey":
					schema.sKey = args[index] ?? Schema.string();
					break;
				case "inner":
					schema.inner = Schema.from(args[index]);
					break;
				case "list":
					schema.list = args[index].map(Schema.from);
					break;
				case "dict":
					schema.dict = mapValues(args[index], Schema.from);
					break;
				case "bits":
					schema.bits = {};
					for (const key in args[index]) {
						if (typeof args[index][key] !== "number") continue;
						schema.bits[key] = args[index][key];
					}
					break;
				case "callback": {
					const callback = schema.callback = args[index];
					callback["toJSON"] ||= () => callback.toString();
					break;
				}
				case "constructor": {
					const constructor = schema.constructor = args[index];
					if (typeof constructor === "function") constructor["toJSON"] ||= () => constructor["name"];
					break;
				}
				default: schema[key] = args[index];
			}
		});
		if (name === "object" || name === "dict") schema.meta.default = {};
		else if (name === "array" || name === "tuple") schema.meta.default = [];
		else if (name === "bitset") schema.meta.default = 0;
		return schema;
	} });
}
defineMethod("is", ["constructor"], ({ constructor }) => {
	if (typeof constructor === "function") return constructor.name;
	else return constructor;
});
defineMethod("any", [], () => "any");
defineMethod("never", [], () => "never");
defineMethod("const", ["value"], ({ value }) => typeof value === "string" ? JSON.stringify(value) : value);
defineMethod("string", [], () => "string");
defineMethod("number", [], () => "number");
defineMethod("boolean", [], () => "boolean");
defineMethod("bitset", ["bits"], () => "bitset");
defineMethod("function", [], () => "function");
defineMethod("array", ["inner"], ({ inner }) => `${inner.toString(true)}[]`);
defineMethod("dict", ["inner", "sKey"], ({ inner, sKey }) => `{ [key: ${sKey.toString()}]: ${inner.toString()} }`);
defineMethod("tuple", ["list"], ({ list }) => `[${list.map((inner) => inner.toString()).join(", ")}]`);
defineMethod("object", ["dict"], ({ dict }) => {
	if (Object.keys(dict).length === 0) return "{}";
	return `{ ${Object.entries(dict).map(([key, inner]) => {
		return `${key}${inner.meta.required ? "" : "?"}: ${inner.toString()}`;
	}).join(", ")} }`;
});
defineMethod("union", ["list"], ({ list }, inline) => {
	const result = list.map(({ toString: format }) => format()).join(" | ");
	return inline ? `(${result})` : result;
});
defineMethod("intersect", ["list"], ({ list }) => {
	return `${list.map((inner) => inner.toString(true)).join(" & ")}`;
});
defineMethod("transform", [
	"inner",
	"callback",
	"preserve"
], ({ inner }, isInner) => inner.toString(isInner));
const CompanionState = Object.freeze({
	IDLE: "IDLE",
	THINKING: "THINKING",
	WORKING: "WORKING",
	WAITING: "WAITING",
	SUCCESS: "SUCCESS",
	ERROR: "ERROR",
	DISCONNECTED: "DISCONNECTED"
});
const CompanionMessageKind = Object.freeze({
	READY: "ready",
	HELLO: "hello",
	STATE: "state",
	PULSE: "pulse",
	TASK: "task",
	TASKS: "tasks",
	CONFIG: "config",
	PING: "ping",
	PONG: "pong",
	CLOSED: "closed",
	SHUTDOWN: "shutdown"
});
const states = new Set(Object.values(CompanionState));
const kinds = new Set(Object.values(CompanionMessageKind));
function createMessage(kind, payload = {}) {
	if (!kinds.has(kind)) throw new TypeError(`Unknown companion message kind: ${kind}`);
	return {
		protocolVersion: 1,
		kind,
		timestamp: Date.now(),
		...payload
	};
}
function assertCompanionMessage(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Companion message must be an object");
	if (value.protocolVersion !== 1) throw new TypeError(`Unsupported protocol version: ${String(value.protocolVersion)}`);
	if (!kinds.has(value.kind)) throw new TypeError(`Unknown companion message kind: ${String(value.kind)}`);
	if ((value.kind === CompanionMessageKind.STATE || value.kind === CompanionMessageKind.PULSE) && !states.has(value.state)) throw new TypeError(`Unknown companion state: ${String(value.state)}`);
	return value;
}
function encodeMessage(message) {
	assertCompanionMessage(message);
	return `${JSON.stringify(message)}\n`;
}
//#endregion
//#region src/host/status-copy.js
const COPY = Object.freeze({
	idle: [
		"我在这儿等新任务哦",
		"现在暂时没任务呢",
		"鲸鲸正在待命中~"
	],
	preparing: [
		"新任务正在梳理中哦~",
		"让我先看看项目呢",
		"正在理清接下来要做什么呀"
	],
	thinking: [
		"正在认真想下一步呢",
		"正在梳理思路哦~",
		"让我整理一下刚才的结果呢"
	],
	searching: [
		"正在帮你找相关内容呢",
		"正在项目里仔细找找哦~",
		"正在查看相关文件呢"
	],
	editing: [
		"这部分正在修改中哦",
		"正在把改动写进去呢",
		"正在认真调整实现呢"
	],
	testing: [
		"正在认真检查结果呢",
		"正在跑测试确认一下哦",
		"正在验证改动有没有问题呢"
	],
	commanding: [
		"正在执行项目命令呢",
		"正在让项目跑起来哦",
		"正在看看命令执行得怎么样呢"
	],
	working: [
		"正在继续处理任务呢",
		"这一步正在进行中哦",
		"鲸鱼女仆还在认真干活呢"
	],
	result: [
		"正在整理刚才的结果呢",
		"这一步处理好了，继续看看哦",
		"正在确认下一步怎么做呢"
	],
	waiting: [
		"需要你确认一下后续呢",
		"这里要等你看一下哦",
		"轮到你来决定下一步啦"
	],
	approval: [
		"需要你审批一下哦",
		"这里在等你的批准呢",
		"有个权限操作要你确认一下啦"
	],
	success: [
		"这次的任务搞定啦~",
		"这一轮顺利完成啦",
		"任务完成咯~"
	],
	toolError: [
		"这一步好像没跑通呢",
		"刚才的操作遇到一点问题哦",
		"这里卡了一下，我再等等你呢"
	],
	error: [
		"任务好像遇到一点问题呢",
		"这里需要回来看看啦",
		"这次没有顺利跑完呢"
	],
	stopped: ["任务已经停下来啦", "这次任务先停在这里哦"],
	limit: ["内容有点多，到上限啦", "这次输出已经到上限咯"]
});
function seedNumber(seed) {
	const number = Number(seed);
	if (Number.isFinite(number)) return Math.abs(Math.trunc(number));
	return [...String(seed ?? "")].reduce((total, character) => total + character.codePointAt(0), 0);
}
function statusCopy(group, seed = 0) {
	const variants = COPY[group] ?? COPY.working;
	return variants[seedNumber(seed) % variants.length];
}
function activityCopy(activity, seed = 0) {
	return statusCopy({
		searching: "searching",
		editing: "editing",
		testing: "testing",
		commanding: "commanding"
	}[activity] ?? "working", seed);
}
function activityStage(activity) {
	return {
		searching: "查找阶段",
		editing: "实现阶段",
		testing: "验证阶段",
		commanding: "执行阶段"
	}[activity] ?? "处理阶段";
}
function taskCopy(task) {
	const value = String(task ?? "").trim().replace(/[。！？.!?]+$/u, "");
	if (!value) return statusCopy("working");
	if (/^(正在|继续)/u.test(value)) return `${value}呢`;
	if (/^(准备|检查|验证|修改|修复|测试|构建|整理|分析|梳理|查找|搜索|读取|实现)/u.test(value)) return `正在${value}呢`;
	return `正在处理「${value}」呢`;
}
//#endregion
//#region src/host/companion-reducer.js
const statePriority = Object.freeze({
	[CompanionState.WAITING]: 60,
	[CompanionState.ERROR]: 50,
	[CompanionState.WORKING]: 30,
	[CompanionState.THINKING]: 20,
	[CompanionState.IDLE]: 0,
	[CompanionState.DISCONNECTED]: -1
});
function toolActivity(name) {
	const value = String(name || "").toLowerCase();
	if (/search|grep|find|glob|web|read|fetch|open/.test(value)) return "searching";
	if (/write|edit|patch|replace|create|move|delete/.test(value)) return "editing";
	if (/test|check|lint|build|verify/.test(value)) return "testing";
	if (/shell|bash|exec|command|terminal|powershell/.test(value)) return "commanding";
	return "using-tool";
}
function toolCallIdOf(event, fallback = "") {
	const content = event?.data?.message?.content;
	const contentCallId = Array.isArray(content) ? content.find((item) => item?.toolCallId)?.toolCallId : void 0;
	return String(event?.data?.message?.source?.callId ?? contentCallId ?? event?.data?.message?.toolCallId ?? event?.data?.message?.callId ?? event?.data?.callId ?? fallback);
}
function isUserQuestionTool(name) {
	const tokens = String(name || "").toLowerCase().split(/[^a-z0-9]+/u).filter(Boolean);
	const asks = /* @__PURE__ */ new Set([
		"ask",
		"asking",
		"request",
		"requests",
		"requesting",
		"require",
		"requires",
		"prompt",
		"needs",
		"need",
		"seek",
		"seeks",
		"get",
		"gets"
	]);
	const filler = /* @__PURE__ */ new Set([
		"for",
		"from",
		"the",
		"a",
		"an"
	]);
	const userWords = /* @__PURE__ */ new Set([
		"user",
		"human",
		"me"
	]);
	const nouns = /* @__PURE__ */ new Set([
		"question",
		"questions",
		"input",
		"answer",
		"answers",
		"decision",
		"decisions",
		"confirmation",
		"approval",
		"permission",
		"authorization",
		"authorisation",
		"consent",
		"clarify",
		"clarification",
		"help"
	]);
	const hasUserNoun = tokens.some((token, index) => userWords.has(token) && nouns.has(tokens[index + 1] ?? ""));
	const hasNounFromUser = tokens.some((token, index) => nouns.has(token) && tokens[index + 1] === "from" && userWords.has(tokens[index + 2] ?? ""));
	const hasAsk = tokens.some((token, index) => {
		if (!asks.has(token)) return false;
		let cursor = index + 1;
		while (cursor < tokens.length && (filler.has(tokens[cursor]) || userWords.has(tokens[cursor]))) {
			if (userWords.has(tokens[cursor])) {
				const next = tokens[cursor + 1];
				return !next || nouns.has(next);
			}
			cursor += 1;
		}
		return cursor < tokens.length && nouns.has(tokens[cursor]);
	});
	const strong = tokens.some((token) => token === "authorize" || token === "authorise" || token === "consent");
	return hasUserNoun || hasNounFromUser || hasAsk || strong;
}
function sessionIdOf(session) {
	return String(session?.header?.id ?? session?.id ?? "unknown-session");
}
function isSubagent(session) {
	return session?.header?.origin === "subagent" || Number(session?.header?.delegationDepth ?? 0) > 0;
}
function cleanProjectName(value) {
	const text = String(value ?? "").trim();
	if (!text) return void 0;
	const pathParts = text.split(/[\\/]/u).filter(Boolean);
	return (pathParts.length > 1 ? pathParts.at(-1) : text).replace(/\s+/gu, " ").slice(0, 40) || void 0;
}
function projectNameOf(session, event) {
	return [
		event?.data?.projectName,
		session?.cwd,
		session?.context?.cwd,
		session?.header?.cwd,
		event?.data?.cwd,
		session?.title,
		session?.name,
		session?.header?.title,
		session?.header?.name
	].map(cleanProjectName).find(Boolean);
}
function progressOf(todos) {
	if (!Array.isArray(todos) || todos.length === 0) return void 0;
	const completed = todos.filter((todo) => [
		"completed",
		"complete",
		"done"
	].includes(todo?.status)).length;
	const currentIndex = todos.findIndex((todo) => todo?.status === "in_progress");
	return {
		completed,
		total: todos.length,
		current: currentIndex >= 0 ? currentIndex + 1 : void 0
	};
}
function detailFor(record, stage = record.payload.stage) {
	const parts = [];
	if (record.project) parts.push(record.project);
	if (record.progress?.total) parts.push(`已完成 ${record.progress.completed}/${record.progress.total} 步`);
	if (record.task) parts.push(record.task);
	else if (stage) parts.push(stage);
	return parts.join(" · ") || stage || "DSH 任务";
}
var CompanionReducer = class {
	constructor({ includeSubagents = false, maxSessions = 256 } = {}) {
		this.includeSubagents = includeSubagents;
		this.sessions = /* @__PURE__ */ new Map();
		this.maxSessions = maxSessions;
		this.clock = 0;
		this.selectedSessionId = void 0;
		this.outputSignature = void 0;
		this.tasksSignature = void 0;
	}
	setIncludeSubagents(value) {
		const includeSubagents = value === true;
		if (includeSubagents === this.includeSubagents) return [];
		this.includeSubagents = includeSubagents;
		if (!includeSubagents) {
			for (const [sessionId, record] of this.sessions) if (record.subagent) this.sessions.delete(sessionId);
		}
		return this.#render();
	}
	handle(session, event) {
		if (!event || typeof event.type !== "string") return [];
		const subagent = isSubagent(session);
		if (!this.includeSubagents && subagent) return [];
		const sessionId = sessionIdOf(session);
		const record = this.#record(sessionId);
		record.subagent = subagent;
		record.lastSeq = Number(event.seq ?? record.lastSeq);
		record.project = projectNameOf(session, event) ?? record.project;
		switch (event.type) {
			case "turn/start":
				record.turnActive = true;
				record.openTools.clear();
				record.waitingCallId = void 0;
				record.waitingApprovalId = void 0;
				record.task = void 0;
				record.progress = void 0;
				this.#update(record, CompanionState.THINKING, {
					phase: "turn-start",
					stage: "准备阶段",
					message: statusCopy("preparing", event.seq)
				});
				return this.#render();
			case "step/start":
			case "assistant/chunk":
			case "assistant/message":
				if (!record.turnActive || record.openTools.size > 0) return [];
				if (record.state === CompanionState.THINKING && record.payload.phase === "thinking") return [];
				this.#update(record, CompanionState.THINKING, {
					phase: "thinking",
					stage: "分析阶段",
					message: statusCopy("thinking", event.seq)
				});
				return this.#render();
			case "tool/call": {
				const callId = toolCallIdOf(event, `seq-${String(event.seq ?? "unknown")}`);
				const name = String(event.data?.name ?? event.data?.message?.name ?? "tool");
				record.openTools.set(callId, name);
				if (isUserQuestionTool(name)) {
					record.waitingCallId = callId;
					this.#update(record, CompanionState.WAITING, {
						phase: "user-question",
						stage: "等待确认",
						toolName: name,
						message: statusCopy("waiting", event.seq)
					});
					return this.#render();
				}
				const activity = toolActivity(name);
				this.#update(record, CompanionState.WORKING, {
					phase: "tool-call",
					activity,
					stage: activityStage(activity),
					toolName: name,
					message: activityCopy(activity, event.seq)
				});
				return this.#render();
			}
			case "tool/result": return this.#toolResult(record, event);
			case "user/message": return this.#userMessage(record, event);
			case "todo/write": return this.#todo(record, event);
			case "turn/end": return this.#turnEnd(record, event);
			case "approval/asked": {
				const id = String(event.data?.id ?? "");
				const toolName = String(event.data?.toolName ?? "approval");
				record.waitingApprovalId = id;
				this.#update(record, CompanionState.WAITING, {
					phase: "approval",
					stage: "等待审批",
					toolName,
					message: statusCopy("approval", event.seq)
				});
				return this.#render();
			}
			case "approval/decided": return this.#approvalDecided(record, event);
			default: return [];
		}
	}
	disposeSession(session) {
		const sessionId = sessionIdOf(session);
		if (!this.sessions.delete(sessionId)) return [];
		return this.#render();
	}
	#toolResult(record, event) {
		const callId = toolCallIdOf(event);
		if (callId) record.openTools.delete(callId);
		if (callId && callId === record.waitingCallId) record.waitingCallId = void 0;
		return this.#resumeAfterTool(record, event);
	}
	#userMessage(record, event) {
		if (!record.waitingCallId) return [];
		record.openTools.delete(record.waitingCallId);
		record.waitingCallId = void 0;
		return this.#resumeAfterTool(record, event);
	}
	#approvalDecided(record, event) {
		const id = String(event.data?.id ?? "");
		if (!record.waitingApprovalId || id !== record.waitingApprovalId) return [];
		record.waitingApprovalId = void 0;
		return this.#resumeAfterTool(record, event);
	}
	#resumeAfterTool(record, event) {
		if (record.waitingApprovalId || record.waitingCallId && record.openTools.has(record.waitingCallId)) return this.#render();
		const next = record.openTools.size > 0 ? CompanionState.WORKING : CompanionState.THINKING;
		const nextPayload = {
			phase: "tool-result",
			activity: next === CompanionState.WORKING ? toolActivity(record.openTools.values().next().value) : void 0,
			stage: next === CompanionState.WORKING ? activityStage(toolActivity(record.openTools.values().next().value)) : "整理阶段",
			message: next === CompanionState.WORKING ? activityCopy(toolActivity(record.openTools.values().next().value), event.seq) : statusCopy("result", event.seq)
		};
		this.#update(record, next, nextPayload);
		if (!event.data?.error) return this.#render();
		const selection = this.#select();
		if (selection.record.state === CompanionState.WAITING || selection.record.state === CompanionState.ERROR) return this.#render(selection);
		this.#remember(selection);
		return this.#withTasks([createMessage(CompanionMessageKind.PULSE, {
			sessionId: record.id,
			sourceSeq: event.seq,
			state: CompanionState.ERROR,
			ttlMs: 1800,
			resumeState: selection.record.state,
			resumeActivity: selection.record.payload.activity,
			resumeMessage: selection.record.payload.message,
			resumeDetail: detailFor(selection.record),
			message: statusCopy("toolError", event.seq),
			detail: detailFor(record),
			errorCode: event.data.error.code
		})]);
	}
	#todo(record, event) {
		const todos = Array.isArray(event.data?.todos) ? event.data.todos : [];
		const current = todos.find((todo) => todo?.status === "in_progress") ?? todos.find((todo) => todo?.status === "pending");
		const progress = progressOf(todos);
		if (!current?.content && !progress) return [];
		const nextTask = current?.content ? String(current.content) : record.task;
		if (nextTask === record.task && progress?.completed === record.progress?.completed && progress?.total === record.progress?.total) return [];
		record.task = nextTask;
		record.progress = progress;
		record.updatedAt = ++this.clock;
		const selection = this.#select();
		if (selection.record.id !== record.id) return this.#render(selection);
		return this.#withTasks([createMessage(CompanionMessageKind.TASK, {
			sessionId: record.id,
			sourceSeq: event.seq,
			task: record.task,
			progress: record.progress,
			project: record.project,
			message: taskCopy(record.task),
			detail: detailFor(record, "执行阶段")
		})]);
	}
	#turnEnd(record, event) {
		record.turnActive = false;
		record.openTools.clear();
		record.waitingCallId = void 0;
		record.waitingApprovalId = void 0;
		const kind = String(event.data?.reason?.kind ?? "completed");
		if (kind === "blocked") {
			this.#update(record, CompanionState.WAITING, {
				phase: "turn-end",
				stage: "等待确认",
				message: statusCopy("waiting", event.seq)
			});
			return this.#render();
		}
		if (kind === "aborted") {
			this.#update(record, CompanionState.IDLE, {
				phase: "turn-end",
				stage: "已停止",
				message: statusCopy("stopped", event.seq)
			});
			return this.#render();
		}
		if (kind !== "completed") {
			this.#update(record, CompanionState.ERROR, {
				phase: "turn-end",
				stage: "需要处理",
				reasonKind: kind,
				message: kind === "max-tokens" ? statusCopy("limit", event.seq) : statusCopy("error", event.seq)
			});
			return this.#render();
		}
		this.#update(record, CompanionState.IDLE, {
			phase: "turn-end",
			stage: "已完成",
			message: statusCopy("idle", event.seq)
		});
		const selection = this.#select();
		if ([CompanionState.WAITING, CompanionState.ERROR].includes(selection.record.state)) return this.#render(selection);
		this.#remember(selection);
		return this.#withTasks([createMessage(CompanionMessageKind.PULSE, {
			sessionId: record.id,
			sourceSeq: event.seq,
			state: CompanionState.SUCCESS,
			resumeState: selection.record.state,
			resumeActivity: selection.record.payload.activity,
			resumeMessage: selection.record.payload.message,
			resumeDetail: detailFor(selection.record),
			ttlMs: 2200,
			phase: "turn-end",
			message: statusCopy("success", event.seq),
			detail: detailFor(record, "本轮已完成")
		})]);
	}
	#record(sessionId) {
		let record = this.sessions.get(sessionId);
		if (record) return record;
		record = {
			id: sessionId,
			state: CompanionState.IDLE,
			payload: {
				phase: "session-created",
				message: "DSH 空闲中"
			},
			turnActive: false,
			openTools: /* @__PURE__ */ new Map(),
			waitingCallId: void 0,
			waitingApprovalId: void 0,
			task: void 0,
			progress: void 0,
			project: void 0,
			subagent: false,
			lastSeq: -1,
			updatedAt: ++this.clock
		};
		this.sessions.set(sessionId, record);
		if (this.sessions.size > this.maxSessions && this.maxSessions > 0) this.#evictSessions(record);
		return record;
	}
	#evictSessions(keep) {
		const records = [...this.sessions.values()].filter((record) => record !== keep);
		const victim = records.filter((record) => record.state === CompanionState.IDLE).sort((left, right) => left.updatedAt - right.updatedAt)[0] ?? records.sort((left, right) => left.updatedAt - right.updatedAt)[0];
		if (victim) this.sessions.delete(victim.id);
	}
	#update(record, state, payload) {
		record.state = state;
		record.payload = payload;
		record.updatedAt = ++this.clock;
	}
	#select() {
		const records = [...this.sessions.values()];
		if (records.length === 0) return { record: {
			id: "dsh-host",
			state: CompanionState.IDLE,
			payload: {
				phase: "no-session",
				message: "DSH 空闲中"
			},
			updatedAt: ++this.clock
		} };
		records.sort((left, right) => {
			return (statePriority[right.state] ?? 0) - (statePriority[left.state] ?? 0) || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
		});
		return { record: records[0] };
	}
	#render(selection = this.#select()) {
		const messages = [];
		if (this.#signature(selection.record) !== this.outputSignature) {
			this.#remember(selection);
			messages.push(createMessage(CompanionMessageKind.STATE, {
				sessionId: selection.record.id,
				state: selection.record.state,
				...selection.record.payload,
				task: selection.record.task,
				progress: selection.record.progress,
				project: selection.record.project,
				detail: detailFor(selection.record)
			}));
		}
		messages.push(...this.#taskMessages());
		return messages;
	}
	#taskMessages() {
		const tasks = this.#activeTaskList();
		if (tasks.length < 2) {
			if (this.tasksSignature !== void 0) {
				this.tasksSignature = void 0;
				return [createMessage(CompanionMessageKind.TASKS, { tasks: [] })];
			}
			return [];
		}
		const signature = tasks.map((task) => [
			task.sessionId,
			task.state,
			task.project ?? "",
			task.task ?? "",
			task.message ?? "",
			task.detail ?? ""
		].join("|")).join("~");
		if (signature === this.tasksSignature) return [];
		this.tasksSignature = signature;
		return [createMessage(CompanionMessageKind.TASKS, { tasks })];
	}
	#activeTaskList() {
		return [...this.sessions.values()].filter((record) => record.state !== CompanionState.IDLE && record.state !== CompanionState.DISCONNECTED).sort((left, right) => {
			return (statePriority[right.state] ?? 0) - (statePriority[left.state] ?? 0) || right.updatedAt - left.updatedAt || left.id.localeCompare(right.id);
		}).map((record) => ({
			sessionId: record.id,
			state: record.state,
			project: record.project,
			task: record.task,
			message: record.payload.message,
			detail: detailFor(record)
		}));
	}
	#withTasks(messages) {
		return [...messages, ...this.#taskMessages()];
	}
	#remember(selection) {
		this.selectedSessionId = selection.record.id;
		this.outputSignature = this.#signature(selection.record);
	}
	#signature(record) {
		return [
			record.id,
			record.state,
			record.payload.activity ?? "",
			record.payload.toolName ?? "",
			record.payload.message ?? "",
			record.project ?? "",
			record.task ?? "",
			record.progress?.completed ?? "",
			record.progress?.total ?? ""
		].join("|");
	}
};
//#endregion
//#region src/host/windows-helper-env.js
const inspectLabel = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class HelperIntegrity {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode)]
  static extern uint GetNamedSecurityInfoW(string name, int type, uint info,
    out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool ConvertSecurityDescriptorToStringSecurityDescriptorW(
    IntPtr descriptor, uint revision, uint info, out IntPtr text, out uint length);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr memory);
  [DllImport("shell32.dll")]
  static extern int SHGetKnownFolderPath(ref Guid folder, uint flags, IntPtr token, out IntPtr path);
  public static string LowDirectory(string executable) {
    IntPtr owner, group, dacl, sacl, descriptor, text;
    uint status = GetNamedSecurityInfoW(executable, 1, 0x10, out owner, out group, out dacl, out sacl, out descriptor);
    if (status != 0) throw new Win32Exception((int)status);
    string label;
    try {
      uint length;
      if (!ConvertSecurityDescriptorToStringSecurityDescriptorW(descriptor, 1, 0x10, out text, out length))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      try { label = Marshal.PtrToStringUni(text); }
      finally { LocalFree(text); }
    } finally { LocalFree(descriptor); }
    if (!label.Contains(";;;LW)")) return null;
    Guid folder = new Guid("A520A1A4-1780-4FF6-BD18-167343C5AF16");
    IntPtr path;
    Marshal.ThrowExceptionForHR(SHGetKnownFolderPath(ref folder, 0, IntPtr.Zero, out path));
    try { return Marshal.PtrToStringUni(path); }
    finally { Marshal.FreeCoTaskMem(path); }
  }
}
'@
[HelperIntegrity]::LowDirectory($env:DSH_HELPER_INSPECT_PATH) | ConvertTo-Json -Compress
`;
function lowIntegrityEnvironment(executable, env) {
	const output = execFileSync(join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe"), [
		"-NoLogo",
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		inspectLabel
	], {
		env: {
			...process.env,
			DSH_HELPER_INSPECT_PATH: executable
		},
		encoding: "utf8",
		windowsHide: true,
		timeout: 1e4,
		stdio: [
			"ignore",
			"pipe",
			"pipe"
		]
	}).trim();
	const localLow = output ? JSON.parse(output) : null;
	if (!localLow) return void 0;
	const directory = join(localLow, "DSH", "maid-whale-webui");
	const temp = join(directory, "temp");
	mkdirSync(temp, { recursive: true });
	return {
		TMP: temp,
		TEMP: temp,
		DSH_DAFEIYU_LAYOUT_PATH: env.DSH_DAFEIYU_LAYOUT_PATH || join(directory, "layout.json")
	};
}
//#endregion
//#region src/host/helper-process.js
const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = [resolve(here, ".."), resolve(here, "..", "..")].find((root) => existsSync(resolve(root, "runtime", "helper.py"))) ?? resolve(here, "..");
const defaultHelperPath = resolve(packageRoot, "runtime", "helper.py");
const bundledHelperPath = resolve(packageRoot, "runtime", "bin", "win32-x64", "dsw-drool-helper.exe");
const DURABLE_MESSAGE_KINDS = /* @__PURE__ */ new Set([
	CompanionMessageKind.HELLO,
	CompanionMessageKind.STATE,
	CompanionMessageKind.TASK,
	CompanionMessageKind.TASKS,
	CompanionMessageKind.CONFIG
]);
function isWsl() {
	if (process.platform !== "linux") return false;
	try {
		return readFileSync("/proc/sys/fs/binfmt_misc/WSLInterop", "utf8").includes("enabled");
	} catch {
		try {
			return /microsoft/i.test(readFileSync("/proc/version", "utf8"));
		} catch {
			return false;
		}
	}
}
function toWindowsPath(path) {
	return execFileSync("wslpath", ["-w", path], { encoding: "utf8" }).trim();
}
function defaultPowerShellExe({ wslpath = defaultWslPath, fileExists = existsSync } = {}) {
	try {
		const candidate = wslpath("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe");
		if (candidate && fileExists(candidate)) return candidate;
	} catch {}
	return "powershell.exe";
}
function defaultWslPath(...args) {
	return execFileSync("wslpath", args, { encoding: "utf8" }).trim();
}
function resolveHelperLaunch({ platform, arch = process.arch, isWslEnv, bundledPath, helperPath, pythonEnv, headless = false, fileExists = existsSync, windowsPath = toWindowsPath, powerShellExe = defaultPowerShellExe }) {
	const supportsBundledHelper = arch === "x64" && (platform === "win32" || platform === "linux" && isWslEnv);
	if (platform === "win32" && supportsBundledHelper && fileExists(bundledPath)) return {
		command: bundledPath,
		args: []
	};
	if (platform === "linux" && isWslEnv && supportsBundledHelper && !headless && fileExists(bundledPath)) return {
		command: powerShellExe(),
		args: [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-Command",
			"& $env:DSH_DAFEIYU_HELPER_EXE"
		],
		env: { DSH_DAFEIYU_HELPER_EXE: windowsPath(bundledPath) }
	};
	if (!supportsBundledHelper && !pythonEnv) return void 0;
	const command = pythonEnv || (platform === "win32" ? "py" : "python3");
	return {
		command,
		args: defaultArgs(command, helperPath)
	};
}
function defaultLaunch(headless = false) {
	return resolveHelperLaunch({
		platform: process.platform,
		isWslEnv: isWsl(),
		bundledPath: bundledHelperPath,
		helperPath: defaultHelperPath,
		pythonEnv: process.env.DSH_DAFEIYU_PYTHON,
		headless
	});
}
function defaultArgs(command, helperPath) {
	if (command === bundledHelperPath) return [];
	if (process.platform === "win32" && /(^|[\\/])py(?:\.exe)?$/i.test(command)) return ["-3", helperPath];
	return [helperPath];
}
var HelperProcess = class {
	constructor(options = {}, logger = console) {
		this.options = options;
		this.logger = logger;
		this.child = void 0;
		this.queue = [];
		this.snapshot = /* @__PURE__ */ new Map();
		this.pending = /* @__PURE__ */ new Map();
		this.spawned = false;
		this.stopping = false;
		this.restartSuppressed = false;
		this.startFailures = 0;
		this.restartTimer = void 0;
		this.heartbeatTimer = void 0;
		this.startupTimer = void 0;
		this.lastPongAt = 0;
		this.recoveryAttempted = false;
		this.recoveryEnv = void 0;
		this.diagnostic = { stderr: "" };
		this.diagnosticPath = options.diagnosticPath ?? (process.platform === "win32" && !options.command && process.env.LOCALAPPDATA ? resolve(process.env.LOCALAPPDATA, "DSH", "maid-whale-webui", "helper-startup.json") : void 0);
	}
	start() {
		if (this.child || this.stopping || this.restartSuppressed) return this.child;
		let child;
		let command;
		let env;
		let tempDirectoryFailed = false;
		try {
			const headless = this.options.headless ?? process.env.DSH_DAFEIYU_HEADLESS === "1";
			const helperPath = this.options.helperPath || defaultHelperPath;
			const launch = this.options.command ? {
				command: this.options.command,
				args: defaultArgs(this.options.command, helperPath)
			} : defaultLaunch(headless);
			if (!launch) {
				this.restartSuppressed = true;
				this.logger.info?.("companion helper is disabled on this platform");
				return;
			}
			command = launch.command;
			const args = this.options.args || launch.args;
			const extraArgs = [];
			const eventLog = this.options.eventLog || process.env.DSH_DAFEIYU_EVENT_LOG;
			const snapshot = this.options.snapshot || process.env.DSH_DAFEIYU_SNAPSHOT;
			if (headless) extraArgs.push("--headless");
			if (eventLog) extraArgs.push("--event-log", eventLog);
			if (snapshot) extraArgs.push("--snapshot", snapshot);
			env = {
				...process.env,
				...this.options.env,
				...launch.env
			};
			if (this.recoveryEnv) this.recoveryEnv = lowIntegrityEnvironment(command, env);
			Object.assign(env, this.recoveryEnv);
			this.#recordDiagnostic({
				command,
				startedAt: (/* @__PURE__ */ new Date()).toISOString(),
				temp: env.TMP || env.TEMP,
				readyAt: void 0,
				exitCode: void 0,
				signal: void 0,
				error: void 0
			});
			child = spawn(command, [...args, ...extraArgs], {
				cwd: this.options.cwd || packageRoot,
				env,
				stdio: [
					"pipe",
					"pipe",
					"pipe"
				],
				windowsHide: true
			});
		} catch (error) {
			this.child = void 0;
			this.spawned = false;
			this.logger.error?.(`companion helper failed to start: ${error.message}`);
			this.#recordDiagnostic({ error: error.message });
			if (!this.stopping && !this.restartSuppressed) this.#countStartFailure(`launch error: ${error.message}`);
			return;
		}
		this.child = child;
		child.stdin.on("error", () => {});
		child.stdin.on("drain", () => {
			if (this.child === child) this.#flushOutgoing();
		});
		child.stdout.on("error", () => {});
		child.stderr.on("error", () => {});
		child.once("spawn", () => {
			const startupTimeoutMs = this.options.startupTimeoutMs ?? 6e4;
			this.startupTimer = setTimeout(() => {
				if (this.child === child && !this.spawned) {
					this.logger.warn?.("companion helper readiness timed out");
					this.#recordDiagnostic({ error: "readiness timed out" });
					child.kill();
				}
			}, startupTimeoutMs);
			this.startupTimer.unref?.();
		});
		child.once("error", (error) => {
			this.logger.error?.(`companion helper failed to start: ${error.message}`);
			this.#recordDiagnostic({ error: error.message });
			if (this.child !== child) return;
			this.child = void 0;
			this.spawned = false;
			this.#clearHeartbeat();
			this.#clearStartupTimer();
			if (!this.stopping && !this.restartSuppressed) this.#countStartFailure(`spawn error: ${error.message}`);
		});
		child.once("close", (code, signal) => {
			if (this.child !== child) return;
			this.child = void 0;
			const wasReady = this.spawned;
			this.spawned = false;
			this.#clearHeartbeat();
			this.#clearStartupTimer();
			this.#recordDiagnostic({
				exitCode: code,
				signal
			});
			if (!this.stopping && !this.restartSuppressed) {
				if (!wasReady) {
					if (process.platform === "win32" && tempDirectoryFailed && !this.recoveryAttempted) {
						this.recoveryAttempted = true;
						try {
							this.recoveryEnv = lowIntegrityEnvironment(command, env);
							if (this.recoveryEnv) {
								this.#recordDiagnostic({ recovery: "low-integrity-temp" });
								this.logger.info?.("companion helper has a Low integrity label; retrying with LocalLow storage");
								this.#scheduleRestart();
								return;
							}
						} catch (error) {
							this.#recordDiagnostic({ recoveryError: error.message });
							this.logger.warn?.(`companion helper integrity check failed: ${error.message}`);
						}
					}
					this.#countStartFailure(`exited before ready (code=${String(code)}, signal=${String(signal)})`);
					return;
				}
				this.logger.warn?.(`companion helper exited (code=${String(code)}, signal=${String(signal)}); restarting`);
				this.#scheduleRestart();
			}
		});
		createInterface({ input: child.stdout }).on("line", (line) => this.#handleReply(line));
		createInterface({ input: child.stderr }).on("line", (line) => {
			if (line.trim()) this.logger.warn?.(`companion helper: ${line}`);
			if (!this.spawned) {
				tempDirectoryFailed ||= /\[PYI-\d+:ERROR\] Could not create temporary directory!/.test(line);
				this.#recordDiagnostic({ stderr: `${this.diagnostic.stderr}${line}\n`.slice(-4096) });
			}
		});
		return child;
	}
	send(message) {
		if (this.stopping || this.restartSuppressed) return;
		const line = encodeMessage(message);
		const durable = DURABLE_MESSAGE_KINDS.has(message.kind);
		if (durable) this.snapshot.set(message.kind, line);
		if (!this.child || !this.spawned || !this.child.stdin.writable || this.child.stdin.destroyed || this.child.stdin.writableNeedDrain) {
			if (durable) this.pending.set(message.kind, line);
			else this.#enqueue(line);
			return;
		}
		this.child.stdin.write(line);
	}
	#recordDiagnostic(fields) {
		Object.assign(this.diagnostic, fields);
		if (!this.diagnosticPath) return;
		try {
			mkdirSync(dirname(this.diagnosticPath), { recursive: true });
			writeFileSync(this.diagnosticPath, `${JSON.stringify(this.diagnostic, null, 2)}\n`);
		} catch (error) {
			this.logger.warn?.(`companion helper diagnostic could not be saved: ${error.message}`);
		}
	}
	stop(reason = "plugin-disposed") {
		this.stopping = true;
		this.#clearHeartbeat();
		if (this.restartTimer) clearTimeout(this.restartTimer);
		this.restartTimer = void 0;
		const child = this.child;
		if (!child) return;
		this.pending.clear();
		this.queue = [encodeMessage(createMessage(CompanionMessageKind.SHUTDOWN, { reason }))];
		this.#flushOutgoing();
		setTimeout(() => {
			if (this.child === child) child.kill();
		}, this.options.shutdownTimeoutMs ?? 1e4).unref?.();
	}
	#enqueue(line) {
		const limit = Math.max(0, this.options.maxQueuedMessages ?? 64);
		if (limit === 0) return;
		this.queue.push(line);
		if (this.queue.length > limit) this.queue.splice(0, this.queue.length - limit);
	}
	#flushOutgoing() {
		const child = this.child;
		if (!this.spawned || !child?.stdin.writable || child.stdin.destroyed || child.stdin.writableNeedDrain) return;
		for (const [kind, line] of this.pending) {
			this.pending.delete(kind);
			if (!child.stdin.write(line)) return;
		}
		while (this.queue.length) if (!child.stdin.write(this.queue.shift())) return;
		if (this.stopping) this.#endInput(child);
	}
	#handleReply(line) {
		if (!line.trim()) return;
		try {
			const reply = JSON.parse(line);
			if (reply?.protocolVersion === 1 && reply.kind === CompanionMessageKind.READY) {
				if (this.spawned) return;
				this.spawned = true;
				this.#recordDiagnostic({
					readyAt: (/* @__PURE__ */ new Date()).toISOString(),
					exitCode: void 0,
					signal: void 0
				});
				this.startFailures = 0;
				this.lastPongAt = Date.now();
				this.#clearStartupTimer();
				this.pending = new Map(this.stopping ? [] : this.snapshot);
				this.#flushOutgoing();
				if (!this.stopping) this.#startHeartbeat();
				return;
			}
			if (reply?.protocolVersion === 1 && reply.kind === CompanionMessageKind.PONG) {
				this.lastPongAt = Date.now();
				return;
			}
			if (reply?.protocolVersion === 1 && reply.kind === CompanionMessageKind.CLOSED) {
				this.restartSuppressed = true;
				return;
			}
		} catch {}
		this.logger.debug?.(`companion helper: ${line}`);
	}
	#startHeartbeat() {
		const heartbeatMs = this.options.heartbeatMs ?? 5e3;
		if (heartbeatMs <= 0) return;
		const timeoutMs = this.options.heartbeatTimeoutMs ?? Math.max(heartbeatMs * 3, 12e3);
		this.heartbeatTimer = setInterval(() => {
			const child = this.child;
			if (!child || !this.spawned) return;
			if (Date.now() - this.lastPongAt > timeoutMs) {
				this.logger.warn?.("companion helper heartbeat timed out");
				child.kill();
				return;
			}
			this.send(createMessage(CompanionMessageKind.PING));
		}, heartbeatMs);
		this.heartbeatTimer.unref?.();
	}
	#clearHeartbeat() {
		if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
		this.heartbeatTimer = void 0;
	}
	#clearStartupTimer() {
		if (this.startupTimer) clearTimeout(this.startupTimer);
		this.startupTimer = void 0;
	}
	#countStartFailure(reason) {
		this.startFailures += 1;
		const maxFailures = this.options.maxStartFailures ?? 5;
		if (this.startFailures >= maxFailures) {
			this.restartSuppressed = true;
			this.queue.length = 0;
			this.logger.error?.(`companion helper failed to start ${this.startFailures} times; giving up (${reason})`);
			return;
		}
		this.logger.warn?.(`companion helper failed to start; scheduling restart (${this.startFailures}/${maxFailures}) (${reason})`);
		this.#scheduleRestart();
	}
	#scheduleRestart() {
		if (this.restartTimer || this.stopping || this.restartSuppressed) return;
		const delay = this.options.restartDelayMs ?? 750;
		this.restartTimer = setTimeout(() => {
			this.restartTimer = void 0;
			this.start();
		}, delay);
		this.restartTimer.unref?.();
	}
	#endInput(child) {
		if (child.stdin.writable && !child.stdin.destroyed) child.stdin.end();
	}
};
//#endregion
//#region src/index.ts
/**
* Host entry: registers the cloud-paper skin's desktop companion (vendored and
* rebranded from QCYTSN/dsh-dafeiyu, MIT). The companion is a transparent
* always-on-top native window whose lifecycle is bound to the DSH host: it
* starts with DSH, keeps rendering while the WebUI is minimized, and exits on
* host shutdown.
*/
const PKG_VERSION = "0.1.1";
const name = "@yunxii/dsh-client-ui-skin-maid-whale-webui";
const inject = ["sessions", "settings"];
const CONFIG_ENDPOINT = "/plugins/maid-whale-webui/config";
const Config = Schema.object({
	enabled: Schema.boolean().default(true).description("启用鲸鱼桌宠"),
	scale: Schema.number().min(.4).max(1.4).step(1e-4).default(.6552).role("slider").description("角色大小"),
	bubbleScale: Schema.number().min(.6).max(1.2).step(.01).default(.78).role("slider").description("气泡大小"),
	activityLevel: Schema.union([
		Schema.const("quiet").description("安静"),
		Schema.const("normal").description("标准"),
		Schema.const("lively").description("活泼")
	]).default("normal").description("空闲微动作频率"),
	reducedMotion: Schema.boolean().default(false).description("减少走动、循环帧和程序化晃动"),
	bubbleMode: Schema.union([
		Schema.const("always").description("常驻显示"),
		Schema.const("hidden").description("完全隐藏"),
		Schema.const("custom").description("自定义显示状态")
	]).default("always").description("气泡显示模式"),
	bubbleStates: Schema.array(Schema.string()).default([
		"SUCCESS",
		"ERROR",
		"WAITING"
	]).description("自定义模式下显示气泡的状态"),
	includeSubagents: Schema.boolean().default(false).description("允许子 Agent 抢占宠物状态")
}).description("由 DeepSeek Harness 状态驱动的鲸鱼桌宠");
const defaults = Object.freeze({
	enabled: true,
	scale: .6552,
	bubbleScale: .78,
	activityLevel: "normal",
	reducedMotion: false,
	bubbleMode: "always",
	bubbleStates: [
		"SUCCESS",
		"ERROR",
		"WAITING"
	],
	includeSubagents: false
});
function publicConfig(config = {}) {
	return {
		enabled: config.enabled ?? defaults.enabled,
		scale: config.scale ?? defaults.scale,
		bubbleScale: config.bubbleScale ?? defaults.bubbleScale,
		activityLevel: config.activityLevel ?? defaults.activityLevel,
		reducedMotion: config.reducedMotion ?? defaults.reducedMotion,
		bubbleMode: config.bubbleMode ?? defaults.bubbleMode,
		bubbleStates: Array.isArray(config.bubbleStates) ? config.bubbleStates : [...defaults.bubbleStates],
		includeSubagents: config.includeSubagents ?? defaults.includeSubagents
	};
}
function localSettingsScope(value) {
	return {
		get: () => value,
		watch: () => () => {}
	};
}
function jsonResponse(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
function isLoopback(address) {
	return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}
async function readPatch(req) {
	const chunks = [];
	let bytes = 0;
	const body = req;
	for await (const chunk of body) {
		bytes += chunk.length;
		if (bytes > 8192) throw new Error("request body is too large");
		chunks.push(Buffer.from(chunk));
	}
	const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("patch must be an object");
	const allowed = new Set(Object.keys(defaults));
	if (Object.keys(value).some((key) => !allowed.has(key))) throw new Error("patch contains an unknown setting");
	return value;
}
function createConfigHandler(settings) {
	return async (req, res) => {
		if (!isLoopback(req.socket?.remoteAddress)) {
			jsonResponse(res, 403, { error: "local access only" });
			return;
		}
		if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(req.headers?.host ?? "")) {
			jsonResponse(res, 403, { error: "untrusted host" });
			return;
		}
		const origin = req.headers?.origin;
		if (origin) {
			let originHost;
			try {
				originHost = new URL(origin).host;
			} catch {}
			if (!originHost || originHost !== req.headers?.host) {
				jsonResponse(res, 403, { error: "origin mismatch" });
				return;
			}
		}
		if (req.method === "GET") {
			jsonResponse(res, 200, settings.get());
			return;
		}
		if (req.method !== "PATCH") {
			jsonResponse(res, 405, { error: "method not allowed" });
			return;
		}
		try {
			const patch = await readPatch(req);
			await settings.update?.(patch);
			jsonResponse(res, 200, settings.get());
		} catch (error) {
			jsonResponse(res, 400, { error: error instanceof Error ? error.message : String(error) });
		}
	};
}
function mount(ctx, config = {}, eventCtx = ctx) {
	const logger = ctx.logger ?? console;
	const base = publicConfig(config);
	const settings = ctx.settings?.register?.("maid-whale-webui", Config, {
		base,
		applies: "live"
	}) ?? localSettingsScope(base);
	let bridge;
	let reducer;
	let restartTimer;
	const stopRuntime = (reason = "settings-change") => {
		bridge?.stop(reason);
		bridge = void 0;
		reducer = void 0;
	};
	const restartRuntime = (next) => {
		stopRuntime("settings-change");
		startRuntime(next);
	};
	const applyLiveSettings = (next) => {
		if (!bridge || !reducer) return;
		for (const message of reducer.setIncludeSubagents(next.includeSubagents === true)) bridge.send(message);
		bridge.send(createMessage(CompanionMessageKind.CONFIG, {
			scale: next.scale ?? defaults.scale,
			bubbleScale: next.bubbleScale ?? defaults.bubbleScale,
			activityLevel: next.activityLevel ?? defaults.activityLevel,
			reducedMotion: next.reducedMotion === true,
			bubbleMode: next.bubbleMode ?? defaults.bubbleMode,
			bubbleStates: Array.isArray(next.bubbleStates) ? next.bubbleStates : [...defaults.bubbleStates]
		}));
	};
	const scheduleRestart = (next) => {
		if (restartTimer) clearTimeout(restartTimer);
		restartTimer = setTimeout(() => {
			restartTimer = void 0;
			restartRuntime(next);
		}, 400);
		restartTimer.unref?.();
	};
	const startRuntime = (resolved) => {
		if (resolved.enabled === false) {
			logger.info?.("maid-whale companion is disabled");
			return;
		}
		const helperConfig = config.helper ?? {};
		bridge = new HelperProcess({
			...helperConfig,
			env: {
				...helperConfig.env,
				DSH_DAFEIYU_SCALE: String(resolved.scale ?? defaults.scale),
				DSH_DAFEIYU_BUBBLE_SCALE: String(resolved.bubbleScale ?? defaults.bubbleScale),
				DSH_DAFEIYU_ACTIVITY_LEVEL: String(resolved.activityLevel ?? defaults.activityLevel),
				DSH_DAFEIYU_REDUCED_MOTION: resolved.reducedMotion === true ? "1" : "0",
				DSH_DAFEIYU_BUBBLE_MODE: String(resolved.bubbleMode ?? defaults.bubbleMode),
				DSH_DAFEIYU_BUBBLE_STATES: (Array.isArray(resolved.bubbleStates) ? resolved.bubbleStates : defaults.bubbleStates).join(","),
				DSH_DAFEIYU_WEBUI_URL: String(process.env.DSH_DESKTOP_NODE_EXECUTABLE ? "dsh://open" : config.webuiUrl ?? process.env.DSH_DAFEIYU_WEBUI_URL ?? "http://127.0.0.1:3080/")
			}
		}, logger);
		reducer = new CompanionReducer({ includeSubagents: resolved.includeSubagents === true });
		bridge.start();
		bridge.send(createMessage(CompanionMessageKind.HELLO, {
			state: CompanionState.IDLE,
			host: "deepseek-harness",
			pluginVersion: PKG_VERSION,
			message: "Cloud whale connected to DSH"
		}));
		bridge.send(createMessage(CompanionMessageKind.STATE, {
			state: CompanionState.IDLE,
			phase: "plugin-start",
			stage: "等待任务",
			message: "鲸鲸在这儿等新任务哦",
			detail: "DSH · 等待下一次任务"
		}));
		logger.info?.("maid-whale companion bridge started");
	};
	startRuntime(settings.get());
	const offEvent = eventCtx.on("session/event", ((session, event) => {
		if (!bridge || !reducer) return;
		try {
			for (const message of reducer.handle(session, event)) bridge.send(message);
		} catch (error) {
			logger.error?.("maid-whale companion failed to handle session event", error);
		}
	}), { global: true });
	const offDisposed = eventCtx.on("session/disposed", ((session) => {
		if (!bridge || !reducer) return;
		try {
			for (const message of reducer.disposeSession(session)) bridge.send(message);
		} catch (error) {
			logger.error?.("maid-whale companion failed to dispose session", error);
		}
	}));
	const unwatch = settings.watch((next) => {
		if (next.enabled === false) {
			if (restartTimer) {
				clearTimeout(restartTimer);
				restartTimer = void 0;
			}
			stopRuntime("settings-change");
			return;
		}
		if (!bridge) {
			scheduleRestart(next);
			return;
		}
		if (restartTimer) {
			clearTimeout(restartTimer);
			restartTimer = void 0;
		}
		applyLiveSettings(next);
	});
	if (typeof ctx.inject === "function") ctx.inject(["webServer"], (webCtx) => {
		const server = webCtx;
		server.effect(() => server.webServer.register({
			kind: "exact",
			path: CONFIG_ENDPOINT,
			handler: createConfigHandler(settings)
		}), "maid-whale-webui: local companion settings endpoint");
	});
	ctx.effect?.(() => () => {
		if (restartTimer) clearTimeout(restartTimer);
		restartTimer = void 0;
		offEvent?.();
		offDisposed?.();
		unwatch();
		stopRuntime("dsh-host-stop");
	}, "ui-skin-maid-whale-webui: companion lifecycle");
}
function apply(ctx, config = {}) {
	const context = ctx;
	if (typeof context.inject === "function") {
		context.inject(["settings"], (settingsCtx) => mount(settingsCtx, config, context));
		return;
	}
	mount(context, config);
}
//#endregion
export { CONFIG_ENDPOINT, CompanionReducer, CompanionState, Config, HelperProcess, apply, createConfigHandler, inject, name };

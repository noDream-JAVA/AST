// U7
var _0x59a70e = function () {
                    function _0x36e40e() {
                        this["marks"] = {}, this["measures"] = {};
                    }
                    return _0x36e40e["prototype"]["start"] = function (_0x512acd) {
                        this["marks"][_0x512acd] = _0x11b499();
                    }, _0x36e40e["prototype"]["startInternal"] = function (_0x41cb7e) {}, _0x36e40e["prototype"]["stop"] = function (_0x315b39) {
                        this["measures"][_0x315b39] = _0x11b499() - this["marks"][_0x315b39];
                    }, _0x36e40e["prototype"]["stopInternal"] = function (_0x249e0a) {}, _0x36e40e["prototype"]["summary"] = function () {
                        return this["measures"];
                    }, _0x36e40e;
                }();




// p0
var pO = Math["random"]() * 1073741824 | 0;

var zJ9 = np(1740574759, pO);

// np
 function np(mt, T0) {
        var ar = T0;
        var ef = mt;
        return function () {
            var BU = ef;
            BU ^= BU << 23;
            BU ^= BU >> 17;
            var dB = ar;
            BU ^= dB;
            BU ^= dB >> 26;
            ar = BU;
            ef = dB;
            return (ef + ar) % 4294967296;
        };
    }



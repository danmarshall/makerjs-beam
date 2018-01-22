import makerjs = require('makerjs');
import { IPoint, IPath, IModel, IPathMap, IWalkOptions, IWalkPath, angle, IPathLine, IPathCircle, IPathArc, IModelMap, pathType, models } from 'makerjs';

function divideArc(arcToDivide: IPathArc, divisionAngles: number[]) {
    const arcs = [arcToDivide];
    divisionAngles.forEach(a => {
        let index = -1;
        for (let i = 0; i < arcs.length; i++) {
            if (makerjs.measure.isBetweenArcAngles(a, arcs[i], true)) {
                index = i;
                break;
            }
        }
        if (index >= 0) {
            //divide the arc at the angle
            const newArc = makerjs.path.clone(arcs[index]) as IPathArc;
            newArc.startAngle = a;
            arcs[index].endAngle = a;
            arcs.splice(index + 1, 0, newArc);
        }
    });
    return arcs;
}

function occludes(occluder: IModel, occludee: IModel) {
    const base = occluder.paths.base;
    const p = occludee.paths;
    var tests = [p.beam, p.ray0, p.ray1];
    for (var i = 0; i < tests.length; i++) {
        if (makerjs.path.intersection(base, tests[i], { excludeTangents: true })) { return true; }
    }
    return false;
}

class Beam implements IModel {
    public paths: IPathMap = {};
    public models: IModelMap;

    constructor(path: IPath, pathOffset: IPoint, beamOffset: IPoint, scale: number, scaleOffset: IPoint, skipTangentCheck = false) {

        makerjs.$(path).clone().moveRelative(pathOffset).addTo(this, 'base');
        makerjs.$(path).clone().moveRelative(pathOffset).scale(scale).moveRelative(makerjs.point.add(beamOffset, scaleOffset)).addTo(this, 'beam');

        if (!skipTangentCheck && (path.type === makerjs.pathType.Arc || path.type === makerjs.pathType.Circle)) {
            var angles = makerjs.solvers.circleTangentAngles(this.paths.base as IPathCircle, this.paths.beam as IPathCircle);

            if (angles) {

                const map: { [pathType: string]: (p: IPath) => void } = {};

                map[makerjs.pathType.Circle] = (circle: IPathCircle) => {
                    const beams = angles.map((a, i) => {
                        const arc = new makerjs.paths.Arc(circle.origin, circle.radius, angles[i === 0 ? 1 : 0], a);
                        return new Beam(arc, pathOffset, beamOffset, scale, scaleOffset, true);
                    });
                    const occludeIndex = occludes(beams[0], beams[1]) ? 0 : 1;
                    delete this.paths;
                    this.models = {
                        "outside": beams[occludeIndex],
                        "inside": beams[1 - occludeIndex]
                    };
                };

                map[makerjs.pathType.Arc] = (arc: IPathArc) => {
                    const dividedArcs = divideArc(arc, angles);
                    if (dividedArcs.length > 1) {
                        const beams = dividedArcs.map(a => {
                            return new Beam(a, pathOffset, beamOffset, scale, scaleOffset, true);
                        });
                        const occludeIndex = occludes(beams[0], beams[1]) ? 0 : 1;
                        if (beams[2]) {
                            //merge first and last
                            for (let pathId in beams[2].paths) {
                                beams[0].paths[pathId + '_2'] = beams[2].paths[pathId];
                            }
                            beams.length = 2;
                        }
                        delete this.paths;
                        this.models = {
                            "outside": beams[occludeIndex],
                            "inside": beams[1 - occludeIndex]
                        };
                    }
                };

                const fn = map[path.type];
                if (fn) {
                    fn(path);
                }
            }
        }

        if (this.paths) {

            let rayEndpoints: IPoint[][] = [];

            if (path.type === makerjs.pathType.Arc || path.type === makerjs.pathType.Line) {
                const ends = [this.paths.base, this.paths.beam].map(p => makerjs.point.fromPathEnds(p));

                rayEndpoints.push(
                    [ends[0][0], ends[1][0]],
                    [ends[0][1], ends[1][1]]
                );
            }

            rayEndpoints.forEach((re, i) => {
                makerjs.$(new makerjs.paths.Line(re[0], re[1])).addTo(this, `ray${i}`);
            });
        }
    }
}

function beam(model: IModel, options: { distance: number, angle: number, scale: number }) {
    const result: IModel = { models: {} };
    const centerLarge = makerjs.measure.modelExtents(model).center;
    const centerSmall = makerjs.point.scale(centerLarge, options.scale);
    const centerOffset = makerjs.point.subtract(centerLarge, centerSmall);
    const beamOffset = makerjs.point.fromPolar(makerjs.angle.toRadians(options.angle), options.distance);
    let layer = 0;
    const walkOptions: IWalkOptions = {
        onPath: function (context: IWalkPath) {
            makerjs.$(new Beam(context.pathContext, context.offset, beamOffset, options.scale, centerOffset))
                .layer(layer.toString())
                .addTo(result, context.routeKey);
            layer++;
        }
    };

    makerjs.model.walk(model, walkOptions);

    return result;
}

export = beam;

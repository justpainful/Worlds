import Foundation

public struct RecognizedDrawingShape: Sendable, Equatable {
    public let shape: String
    public let x: Double, y: Double, width: Double, height: Double
    public let points: [ToolPoint]
    public let confidence: Double
}

/// Line, rectangle, ellipse, triangle and right triangle recognition with the
/// thresholds of `src/drawing/recognition.ts`. `ShapeCorrection` turns a result
/// into the desktop's corrected shape node.
public enum ShapeRecognition {
    private static func distance(_ a: ToolPoint, _ b: ToolPoint) -> Double { hypot(a.x-b.x,a.y-b.y) }
    private static func bounds(_ p: [ToolPoint]) -> (Double,Double,Double,Double) {
        let x = p.map(\.x).min()!, y = p.map(\.y).min()!
        return (x,y,max(1,p.map(\.x).max()!-x),max(1,p.map(\.y).max()!-y))
    }
    private static func lineDistance(_ p: ToolPoint, _ a: ToolPoint, _ b: ToolPoint) -> Double {
        let dx=b.x-a.x, dy=b.y-a.y, denominator=dx*dx+dy*dy
        let t=max(0,min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(denominator == 0 ? 1 : denominator)))
        return distance(p, ToolPoint(x:a.x+t*dx,y:a.y+t*dy))
    }
    private static func simplify(_ points: [ToolPoint], _ tolerance: Double) -> [ToolPoint] {
        guard points.count >= 3 else { return points }
        var farthest=tolerance, index = -1
        for i in 1..<(points.count-1) {
            let d=lineDistance(points[i],points[0],points[points.count-1])
            if d>farthest { farthest=d; index=i }
        }
        guard index >= 0 else { return [points[0],points[points.count-1]] }
        return Array(simplify(Array(points[0...index]),tolerance).dropLast()) + simplify(Array(points[index...]),tolerance)
    }
    public static func recognize(_ input: [ToolPoint]) -> RecognizedDrawingShape? {
        guard input.count >= 6, input.allSatisfy({ $0.x.isFinite && $0.y.isFinite }) else { return nil }
        let points: [ToolPoint] = input.count <= 1200 ? input : (0..<1200).map { input[Int((Double($0) * Double(input.count-1) / 1199).rounded())] }
        let (x,y,w,h)=bounds(points), diagonal=hypot(w,h)
        guard diagonal >= 24 else { return nil }
        let first=points[0], last=points[points.count-1]
        let total=zip(points,points.dropFirst()).reduce(0.0) { $0 + distance($1.0,$1.1) }
        if distance(first,last) > diagonal*0.24 {
            let error=points.reduce(0.0) { $0 + lineDistance($1,first,last) } / Double(points.count)
            let straight=distance(first,last)/max(1,total)
            guard error < diagonal*0.045, straight > 0.92 else { return nil }
            return .init(shape:"line",x:x,y:y,width:w,height:h,points:[first,last],confidence:straight)
        }
        var ai=0, bi=0, far=0.0
        let stride=max(1,points.count/120)
        for a in Swift.stride(from: 0, to: points.count, by: stride) {
            for b in Swift.stride(from: a+stride, to: points.count, by: stride) {
                let d=distance(points[a],points[b]); if d>far { ai=a; bi=b; far=d }
            }
        }
        guard bi>ai else { return nil }
        let tolerance=diagonal*0.055
        let f=simplify(Array(points[ai...bi]),tolerance)
        let reverse=Array(points[bi...])+Array(points[0...ai])
        let b=simplify(reverse,tolerance)
        let raw=Array(f.dropLast())+Array(b.dropLast())
        guard !raw.isEmpty else { return nil }
        let corners=raw.enumerated().compactMap { i,p in lineDistance(p,raw[(i+raw.count-1)%raw.count],raw[(i+1)%raw.count]) > tolerance*0.65 ? p : nil }
        if corners.count == 3 {
        let area=abs((0..<3).reduce(0.0) { sum,i in sum+corners[i].x*corners[(i+1)%3].y-corners[i].y*corners[(i+1)%3].x })
        guard area >= w*h*0.3 else { return nil }
        for i in 0..<3 {
            let p=corners[i], a=corners[(i+1)%3], b=corners[(i+2)%3]
            let ax=a.x-p.x, ay=a.y-p.y, bx=b.x-p.x, by=b.y-p.y
            let denominator=hypot(ax,ay)*hypot(bx,by)
            let cosine=abs((ax*bx+ay*by)/(denominator == 0 ? 1 : denominator))
            if cosine < 0.27 {
                let len=hypot(ax,ay); guard len>0 else { continue }
                let ux=ax/len, uy=ay/len, signed=bx * -uy + by*ux
                let vertices=[p,a,ToolPoint(x:p.x-uy*signed,y:p.y+ux*signed)]
                let (rx,ry,rw,rh)=bounds(vertices)
                return .init(shape:"right-triangle",x:rx,y:ry,width:rw,height:rh,points:vertices,confidence:1-cosine*0.3)
            }
        }
        return .init(shape:"triangle",x:x,y:y,width:w,height:h,points:corners,confidence:0.91)
        }
        if corners.count == 4 {
            let boundary=corners.allSatisfy { p in
                min(abs(p.x-x),abs(p.x-x-w)) < diagonal*0.09 && min(abs(p.y-y),abs(p.y-y-h)) < diagonal*0.09
            }
            if boundary { return .init(shape:"rect",x:x,y:y,width:w,height:h,points:[],confidence:0.93) }
            let a=corners[0], b=corners[1], c=corners[2], d=corners[3]
            let ux=(b.x-a.x+c.x-d.x)/2, uy=(b.y-a.y+c.y-d.y)/2
            let vx=(d.x-a.x+c.x-b.x)/2, vy=(d.y-a.y+c.y-b.y)/2
            let width=hypot(ux,uy), height=hypot(vx,vy), divisor=width*height
            let cosine=abs((ux*vx+uy*vy)/(divisor == 0 ? 1 : divisor))
            let closure=hypot(a.x+c.x-b.x-d.x,a.y+c.y-b.y-d.y)/diagonal
            if width > diagonal*0.12, height > diagonal*0.12, cosine < 0.22, closure < 0.14 {
                let ex=ux/width, ey=uy/width, signedHeight=vx * -ey + vy*ex
                let center=ToolPoint(x:(a.x+b.x+c.x+d.x)/4,y:(a.y+b.y+c.y+d.y)/4)
                let vertices=[(-1.0,-1.0),(1.0,-1.0),(1.0,1.0),(-1.0,1.0)].map { pair in
                    let (sx, sy) = pair
                    return ToolPoint(x:center.x+sx*ux/2-sy*ey*signedHeight/2, y:center.y+sx*uy/2+sy*ex*signedHeight/2)
                }
                let (rx,ry,rw,rh)=bounds(vertices)
                return .init(shape:"rect",x:rx,y:ry,width:rw,height:rh,points:vertices,confidence:1-max(cosine,closure))
            }
        }
        let rx=w/2, ry=h/2
        guard rx >= 10, ry >= 10 else { return nil }
        let error=points.reduce(0.0) { sum,p in
            sum+abs(hypot((p.x-x-rx)/rx,(p.y-y-ry)/ry)-1)
        }/Double(points.count)
        if corners.count >= 5, error < 0.1, total < .pi*(rx+ry)*1.25 {
            return .init(shape:"ellipse",x:x,y:y,width:w,height:h,points:[],confidence:1-error)
        }
        return nil
    }
}



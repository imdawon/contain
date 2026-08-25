declare module "box3d-wasm/standard" {
  export interface Vec3 {
    x: number;
    y: number;
    z: number;
  }

  export interface Quat {
    x: number;
    y: number;
    z: number;
    w: number;
  }

  export interface Box3DBody {
    createBox(opts: {
      halfExtents: Vec3;
      density?: number;
      friction?: number;
      restitution?: number;
    }): unknown;
    getPosition(): Vec3;
    getRotation(): Quat;
    getType(): string;
    setType(t: "static" | "kinematic" | "dynamic"): void;
    applyMassFromShapes(): void;
    applyLinearImpulseToCenter(v: Vec3, wake?: boolean): void;
    applyAngularImpulse(v: Vec3, wake?: boolean): void;
    setAwake(v: boolean): void;
    setBullet(v: boolean): void;
    destroy(): void;
    delete(): void;
  }

  export interface Box3DWorld {
    createBody(opts: {
      type?: "static" | "kinematic" | "dynamic";
      position?: Vec3;
      rotation?: Quat;
      linearVelocity?: Vec3;
      angularDamping?: number;
    }): Box3DBody;
    step(dt: number, substeps?: number): void;
    explode(opts: {
      position: Vec3;
      radius?: number;
      falloff?: number;
      impulsePerArea?: number;
    }): void;
    destroy(): void;
    setGravity(v: Vec3): void;
  }

  export interface Box3DModule {
    World: new (opts?: {
      gravity?: Vec3;
      enableSleep?: boolean;
      enableContinuous?: boolean;
    }) => Box3DWorld;
    threaded: boolean;
  }

  export default function Box3D(): Promise<Box3DModule>;
}

import * as THREE from 'three';import {world,shore,SCALE} from './coast/beach-bridge.mjs';
export function createSurfBodies(scene){const person=new THREE.Group();
 const skin=new THREE.MeshStandardMaterial({color:0xddaa80,roughness:.9}),shirt=new THREE.Mesh(new THREE.BoxGeometry(2.4,4.6,1.9),new THREE.MeshStandardMaterial({color:0xe95e2d,roughness:.8}));shirt.position.y=.8;person.add(shirt);
 const head=new THREE.Mesh(new THREE.SphereGeometry(.95,16,12),skin);head.position.y=3.95;person.add(head);
 const shorts=new THREE.Mesh(new THREE.BoxGeometry(2.2,2.2,1.7),new THREE.MeshStandardMaterial({color:0x142f55}));shorts.position.y=-2.2;person.add(shorts);
 for(const x of [-.7,.7]){const leg=new THREE.Mesh(new THREE.BoxGeometry(.65,2,.7),skin);leg.position.set(x,-4.25,0);person.add(leg);}scene.add(person);
 return {person,update(show=true){const b=world.person;person.visible=!!b&&show;if(!b)return;person.position.set(b.x*SCALE,b.y*SCALE,shore(0)+b.z*SCALE);person.quaternion.set(...b.q);}};
}

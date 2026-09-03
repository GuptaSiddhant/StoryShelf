function R({label:W,variant:i="primary",onClick:z}){const I={fontFamily:"system-ui, sans-serif",fontSize:14,padding:"8px 16px",borderRadius:6,border:i==="primary"?"none":"1px solid #ccc",background:i==="primary"?"#2b7fff":"#ffffff",color:i==="primary"?"#ffffff":"#09090b",cursor:"pointer"};return React.createElement("button",{type:"button",style:I,onClick:z},W)}R.__docgenInfo={description:"",methods:[],displayName:"Button",props:{label:{required:!0,tsType:{name:"string"},description:""},variant:{required:!1,tsType:{name:"union",raw:'"primary" | "secondary"',elements:[{name:"literal",value:'"primary"'},{name:"literal",value:'"secondary"'}]},description:"",defaultValue:{value:'"primary"',computed:!1}},onClick:{required:!1,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""}}};const N={title:"Components/Button",component:R,args:{label:"Button"}},a={args:{variant:"primary"}},r={args:{variant:"secondary"}},e={args:{variant:"primary",label:"Disabled"},tags:["skip"],parameters:{storyshelf:{disableSnapshot:!0}}},s={args:{variant:"primary",label:"Flaky Tag"},tags:["flaky-test"],play:async()=>{throw new Error("flaky tag failure")}},n={args:{variant:"secondary",label:"Flaky Param"},tags:["flaky-test"],parameters:{storyshelf:{flakyTest:!0}},play:async()=>{throw new Error("flaky param failure")}},t={args:{variant:"primary",label:"Chromatic Flaky"},tags:["flaky-test"],parameters:{chromatic:{flakyTest:!0}},play:async()=>{throw new Error("chromatic flaky")}},o={args:{variant:"secondary",label:"Blocking"},play:async()=>{throw new Error("blocking play failure")}},l={args:{variant:"primary",label:"Delayed"},parameters:{storyshelf:{delay:100}}};var c,y,p;a.parameters={...a.parameters,docs:{...(c=a.parameters)==null?void 0:c.docs,source:{originalSource:`{
  args: {
    variant: "primary"
  }
}`,...(p=(y=a.parameters)==null?void 0:y.docs)==null?void 0:p.source}}};var m,d,u;r.parameters={...r.parameters,docs:{...(m=r.parameters)==null?void 0:m.docs,source:{originalSource:`{
  args: {
    variant: "secondary"
  }
}`,...(u=(d=r.parameters)==null?void 0:d.docs)==null?void 0:u.source}}};var f,g,k;e.parameters={...e.parameters,docs:{...(f=e.parameters)==null?void 0:f.docs,source:{originalSource:`{
  args: {
    variant: "primary",
    label: "Disabled"
  },
  tags: ["skip"],
  parameters: {
    storyshelf: {
      disableSnapshot: true
    }
  }
}`,...(k=(g=e.parameters)==null?void 0:g.docs)==null?void 0:k.source}}};var b,h,v;s.parameters={...s.parameters,docs:{...(b=s.parameters)==null?void 0:b.docs,source:{originalSource:`{
  args: {
    variant: "primary",
    label: "Flaky Tag"
  },
  tags: ["flaky-test"],
  play: async () => {
    throw new Error("flaky tag failure");
  }
}`,...(v=(h=s.parameters)==null?void 0:h.docs)==null?void 0:v.source}}};var w,F,S;n.parameters={...n.parameters,docs:{...(w=n.parameters)==null?void 0:w.docs,source:{originalSource:`{
  args: {
    variant: "secondary",
    label: "Flaky Param"
  },
  tags: ["flaky-test"],
  parameters: {
    storyshelf: {
      flakyTest: true
    }
  },
  play: async () => {
    throw new Error("flaky param failure");
  }
}`,...(S=(F=n.parameters)==null?void 0:F.docs)==null?void 0:S.source}}};var T,E,B;t.parameters={...t.parameters,docs:{...(T=t.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    variant: "primary",
    label: "Chromatic Flaky"
  },
  tags: ["flaky-test"],
  parameters: {
    chromatic: {
      flakyTest: true
    }
  } as unknown as Record<string, unknown>,
  play: async () => {
    throw new Error("chromatic flaky");
  }
}`,...(B=(E=t.parameters)==null?void 0:E.docs)==null?void 0:B.source}}};var D,C,P;o.parameters={...o.parameters,docs:{...(D=o.parameters)==null?void 0:D.docs,source:{originalSource:`{
  args: {
    variant: "secondary",
    label: "Blocking"
  },
  play: async () => {
    throw new Error("blocking play failure");
  }
}`,...(P=(C=o.parameters)==null?void 0:C.docs)==null?void 0:P.source}}};var x,_,q;l.parameters={...l.parameters,docs:{...(x=l.parameters)==null?void 0:x.docs,source:{originalSource:`{
  args: {
    variant: "primary",
    label: "Delayed"
  },
  parameters: {
    storyshelf: {
      delay: 100
    }
  }
}`,...(q=(_=l.parameters)==null?void 0:_.docs)==null?void 0:q.source}}};const O=["Primary","Secondary","Disabled","FlakyTag","FlakyParam","ChromaticFlaky","BlockingFailure","WithDelay"];export{o as BlockingFailure,t as ChromaticFlaky,e as Disabled,n as FlakyParam,s as FlakyTag,a as Primary,r as Secondary,l as WithDelay,O as __namedExportsOrder,N as default};

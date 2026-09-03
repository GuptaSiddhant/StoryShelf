function p({label:m,variant:a="primary",onClick:d}){const u={fontFamily:"system-ui, sans-serif",fontSize:14,padding:"8px 16px",borderRadius:6,border:a==="primary"?"none":"1px solid #ccc",background:a==="primary"?"#2b7fff":"#ffffff",color:a==="primary"?"#ffffff":"#09090b",cursor:"pointer"};return React.createElement("button",{type:"button",style:u,onClick:d},m)}p.__docgenInfo={description:"",methods:[],displayName:"Button",props:{label:{required:!0,tsType:{name:"string"},description:""},variant:{required:!1,tsType:{name:"union",raw:'"primary" | "secondary"',elements:[{name:"literal",value:'"primary"'},{name:"literal",value:'"secondary"'}]},description:"",defaultValue:{value:'"primary"',computed:!1}},onClick:{required:!1,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""}}};const l={title:"Components/Button",component:p,args:{label:"Button"}},r={args:{variant:"primary"}},e={args:{variant:"secondary"}};var n,t,o;r.parameters={...r.parameters,docs:{...(n=r.parameters)==null?void 0:n.docs,source:{originalSource:`{
  args: {
    variant: "primary"
  }
}`,...(o=(t=r.parameters)==null?void 0:t.docs)==null?void 0:o.source}}};var s,i,c;e.parameters={...e.parameters,docs:{...(s=e.parameters)==null?void 0:s.docs,source:{originalSource:`{
  args: {
    variant: "secondary"
  }
}`,...(c=(i=e.parameters)==null?void 0:i.docs)==null?void 0:c.source}}};const f=["Primary","Secondary"];export{r as Primary,e as Secondary,f as __namedExportsOrder,l as default};
